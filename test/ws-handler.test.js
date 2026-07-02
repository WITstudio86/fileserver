const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const initSqlJs = require('sql.js');
const { WebSocketServer } = require('ws');
const { WebSocket } = require('ws');
const { setupWebSocket } = require('../src/ws-handler');

/** SQLite schema matching production */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'unused',
  service_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,
  code TEXT,
  status TEXT NOT NULL DEFAULT 'configuring',
  share_path TEXT,
  max_users INTEGER DEFAULT 10,
  allow_upload INTEGER DEFAULT 0,
  current_users INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  expires_at TEXT
);
CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/**
 * Helper: create a test server with WebSocket support,
 * return { server, port, connect } where connect() returns a Promise<WebSocket>
 */
function createTestServer(db) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    setupWebSocket(wss, db);

    server.on('upgrade', (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        connect: () => {
          return new Promise((res, rej) => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
            ws.on('open', () => res(ws));
            ws.on('error', rej);
          });
        },
      });
    });

    server.on('error', reject);
  });
}

/** Wait for a WebSocket message, returns parsed JSON */
function waitForMessage(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe('WebSocket ping/pong', () => {
  /** @type {Awaited<ReturnType<createTestServer>>} */
  let testEnv;

  before(async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(SCHEMA);
    testEnv = await createTestServer(db);
  });

  after(() => {
    testEnv.server.close();
  });

  it('should reply pong when client sends ping', async () => {
    const ws = await testEnv.connect();

    ws.send(JSON.stringify({ type: 'ping' }));
    const response = await waitForMessage(ws);

    assert.strictEqual(response.type, 'pong');

    ws.close();
  });
});

describe('WebSocket chat-message broadcast', () => {
  /** @type {Awaited<ReturnType<createTestServer>>} */
  let testEnv;
  const SERVICE_ID = 'svc-test-1';
  const SERVICE_CODE = '5678';
  const TOKEN = 'tok-test-1';

  before(async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(SCHEMA);

    // Insert a used token linked to an active service
    db.run(
      "INSERT INTO tokens (id, status, service_id, expires_at) VALUES (?, 'used', ?, datetime('now', '+12 hours'))",
      [TOKEN, SERVICE_ID]
    );
    db.run(
      "INSERT INTO services (id, token_id, code, status, max_users, allow_upload, current_users) VALUES (?, ?, ?, 'active', 10, 1, 0)",
      [SERVICE_ID, TOKEN, SERVICE_CODE]
    );

    testEnv = await createTestServer(db);
  });

  after(() => {
    testEnv.server.close();
  });

  it('should broadcast chat-message to all clients in the service (including sender)', async () => {
    // Host connects and registers
    const host = await testEnv.connect();
    host.send(JSON.stringify({ type: 'register', code: SERVICE_CODE, token: TOKEN }));
    const hostJoined = await waitForMessage(host);
    assert.strictEqual(hostJoined.type, 'joined');

    // Joiner connects and joins
    const joiner = await testEnv.connect();
    joiner.send(JSON.stringify({ type: 'join', code: SERVICE_CODE, username: 'Alice' }));
    const joinerJoined = await waitForMessage(joiner);
    assert.strictEqual(joinerJoined.type, 'joined');

    // Host sends chat-message
    const chatMsg = { type: 'chat-message', text: 'Hello everyone!', from: 'Host', time: '12:00:00' };
    host.send(JSON.stringify(chatMsg));

    // Both host and joiner should receive it
    const hostReceived = await waitForMessage(host);
    const joinerReceived = await waitForMessage(joiner);

    assert.strictEqual(hostReceived.type, 'chat-message');
    assert.strictEqual(hostReceived.text, 'Hello everyone!');
    assert.strictEqual(joinerReceived.type, 'chat-message');
    assert.strictEqual(joinerReceived.text, 'Hello everyone!');

    host.close();
    joiner.close();
  });
});
