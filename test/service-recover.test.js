const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const initSqlJs = require('sql.js');
const { v4: uuidv4 } = require('uuid');

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
`;

describe('Service recovery — closeServiceByCode + code reuse', () => {
  /** @type {import('sql.js').Database} */
  let db;
  let dbModule;

  before(async () => {
    // Redirect DB_PATH so saveDb writes to a temp location
    process.env.DATABASE_PATH = '/tmp/fileserver-test-recover.db';

    // Clear require cache to pick up new DB_PATH
    delete require.cache[require.resolve('../src/db')];
    dbModule = require('../src/db');

    const SQL = await initSqlJs();
    db = new SQL.Database();
    db.run(SCHEMA);
  });

  after(() => {
    // Restore db.js module cache to default DB_PATH
    delete require.cache[require.resolve('../src/db')];
    delete process.env.DATABASE_PATH;
    require('../src/db');
  });

  it('closeServiceByCode should close active services with matching code', () => {
    const token = uuidv4();
    const serviceId = uuidv4();
    const code = '1111';

    db.run("INSERT INTO tokens (id, status, service_id, expires_at) VALUES (?, 'used', ?, datetime('now', '+12 hours'))", [token, serviceId]);
    db.run("INSERT INTO services (id, token_id, code, status, share_path, max_users) VALUES (?, ?, ?, 'active', '/test', 10)", [serviceId, token, code]);

    // Verify it exists
    let rows = db.exec("SELECT status FROM services WHERE code = ? AND status = 'active'", [code]);
    assert.strictEqual(rows.length, 1);

    // Close by code
    dbModule.closeServiceByCode(db, code);

    // Verify it's closed
    rows = db.exec("SELECT status FROM services WHERE code = ? AND status = 'active'", [code]);
    assert.strictEqual(rows.length, 0);
  });

  it('closeServiceByCode should not affect services with different code', () => {
    const tokenA = uuidv4();
    const serviceA = uuidv4();
    const tokenB = uuidv4();
    const serviceB = uuidv4();

    db.run("INSERT INTO tokens (id, status, service_id, expires_at) VALUES (?, 'used', ?, datetime('now', '+12 hours'))", [tokenA, serviceA]);
    db.run("INSERT INTO tokens (id, status, service_id, expires_at) VALUES (?, 'used', ?, datetime('now', '+12 hours'))", [tokenB, serviceB]);
    db.run("INSERT INTO services (id, token_id, code, status, share_path, max_users) VALUES (?, ?, '2222', 'active', '/a', 10)", [serviceA, tokenA]);
    db.run("INSERT INTO services (id, token_id, code, status, share_path, max_users) VALUES (?, ?, '3333', 'active', '/b', 10)", [serviceB, tokenB]);

    dbModule.closeServiceByCode(db, '2222');

    let rows = db.exec("SELECT status FROM services WHERE code = '2222' AND status = 'active'");
    assert.strictEqual(rows.length, 0);

    rows = db.exec("SELECT status FROM services WHERE code = '3333' AND status = 'active'");
    assert.strictEqual(rows.length, 1);
  });

  it('checkCodeExists should return false for closed services (allowing code reuse)', () => {
    const token = uuidv4();
    const serviceId = uuidv4();
    const code = '4444';

    db.run("INSERT INTO tokens (id, status, service_id, expires_at) VALUES (?, 'used', ?, datetime('now', '+12 hours'))", [token, serviceId]);
    db.run("INSERT INTO services (id, token_id, code, status, share_path, max_users) VALUES (?, ?, ?, 'active', '/test', 10)", [serviceId, token, code]);

    assert.strictEqual(dbModule.checkCodeExists(db, code), true);

    dbModule.closeServiceByCode(db, code);

    assert.strictEqual(dbModule.checkCodeExists(db, code), false);
  });

  it('should allow creating a new service with the same code after closing old one', () => {
    const code = '5555';
    const oldToken = uuidv4();
    const oldService = uuidv4();

    // Create old active service
    db.run("INSERT INTO tokens (id, status, service_id, expires_at) VALUES (?, 'used', ?, datetime('now', '+12 hours'))", [oldToken, oldService]);
    db.run("INSERT INTO services (id, token_id, code, status, share_path, max_users) VALUES (?, ?, ?, 'active', '/old', 10)", [oldService, oldToken, code]);

    // Close it by code
    dbModule.closeServiceByCode(db, code);

    // Create new service with same code
    const newToken = uuidv4();
    const newService = uuidv4();
    db.run("INSERT INTO tokens (id, status, service_id, expires_at) VALUES (?, 'used', ?, datetime('now', '+12 hours'))", [newToken, newService]);
    db.run("INSERT INTO services (id, token_id, code, status, share_path, max_users) VALUES (?, ?, ?, 'active', '/new', 10)", [newService, newToken, code]);

    // checkCodeExists should return true for the new active service
    assert.strictEqual(dbModule.checkCodeExists(db, code), true);

    // Only one service should be active with this code
    const rows = db.exec("SELECT COUNT(*) as cnt FROM services WHERE code = ? AND status = 'active'", [code]);
    assert.strictEqual(rows[0].values[0][0], 1);
  });
});
