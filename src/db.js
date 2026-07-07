const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || 'data/fileserver.db';

let SQL;

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

CREATE INDEX IF NOT EXISTS idx_tokens_status ON tokens(status);
CREATE INDEX IF NOT EXISTS idx_services_code ON services(code);
CREATE INDEX IF NOT EXISTS idx_services_token ON services(token_id);
CREATE INDEX IF NOT EXISTS idx_logs_service ON activity_logs(service_id);

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
`;

function saveDb(db) {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

async function initDb() {
  SQL = await initSqlJs();

  let db;
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(SCHEMA);
  saveDb(db);

  // Expire old tokens
  db.run("UPDATE tokens SET status = 'expired' WHERE status = 'unused' AND expires_at < datetime('now')");
  saveDb(db);

  return db;
}

function getDb() {
  if (!SQL) throw new Error('Database not initialized');
}

// ── Token helpers ──

function createToken(db, id, expiresAt) {
  db.run('INSERT INTO tokens (id, expires_at) VALUES (?, ?)', [id, expiresAt]);
  saveDb(db);
}

function getToken(db, id) {
  const rows = db.exec('SELECT id, status, service_id, expires_at FROM tokens WHERE id = ?', [id]);
  if (!rows.length || !rows[0].values.length) return null;
  const [tid, status, serviceId, expiresAt] = rows[0].values[0];
  return { id: tid, status, serviceId, expiresAt };
}

function markTokenUsed(db, tokenId, serviceId) {
  db.run("UPDATE tokens SET status = 'used', service_id = ?, used_at = datetime('now') WHERE id = ?", [serviceId, tokenId]);
  saveDb(db);
}

function expireTokens(db) {
  db.run("UPDATE tokens SET status = 'expired' WHERE status = 'unused' AND expires_at < datetime('now')");
  saveDb(db);
}

// ── Service helpers ──

function createService(db, serviceId, tokenId, code, maxUsers, allowUpload, sharePath) {
  db.run(
    'INSERT INTO services (id, token_id, code, status, share_path, max_users, allow_upload) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [serviceId, tokenId, code, 'configuring', sharePath, maxUsers, allowUpload ? 1 : 0]
  );
  saveDb(db);
}

function startService(db, tokenId) {
  db.run("UPDATE services SET status = 'active', started_at = datetime('now') WHERE token_id = ?", [tokenId]);
  saveDb(db);
}

function closeService(db, tokenId) {
  db.run("UPDATE services SET status = 'closed' WHERE token_id = ?", [tokenId]);
  saveDb(db);
}

function closeServiceByCode(db, code) {
  db.run("UPDATE services SET status = 'closed' WHERE code = ? AND status IN ('configuring', 'active')", [code]);
  saveDb(db);
}

function getServiceByToken(db, tokenId) {
  const rows = db.exec('SELECT id, code, status, share_path, max_users, allow_upload, current_users FROM services WHERE token_id = ?', [tokenId]);
  if (!rows.length || !rows[0].values.length) return null;
  const [id, code, status, sharePath, maxUsers, allowUpload, currentUsers] = rows[0].values[0];
  return { id, code, status, sharePath, maxUsers, allowUpload: !!allowUpload, currentUsers };
}

function getServiceByCode(db, code) {
  const rows = db.exec(
    "SELECT id, allow_upload, current_users, max_users FROM services WHERE code = ? AND status = 'active'",
    [code]
  );
  if (!rows.length || !rows[0].values.length) return null;
  const [serviceId, allowUpload, currentUsers, maxUsers] = rows[0].values[0];
  return { serviceId, allowUpload: !!allowUpload, currentUsers, maxUsers };
}

function getServiceById(db, serviceId) {
  const rows = db.exec('SELECT id, token_id, code, status, current_users, max_users, allow_upload, share_path FROM services WHERE id = ?', [serviceId]);
  if (!rows.length || !rows[0].values.length) return null;
  const [id, tokenId, code, status, currentUsers, maxUsers, allowUpload, sharePath] = rows[0].values[0];
  return { id, tokenId, code, status, currentUsers, maxUsers, allowUpload, sharePath };
}

function checkCodeExists(db, code) {
  const rows = db.exec(
    "SELECT id FROM services WHERE code = ? AND status IN ('configuring', 'active')",
    [code]
  );
  return rows.length > 0 && rows[0].values.length > 0;
}

function incrementUserCount(db, serviceId) {
  db.run('UPDATE services SET current_users = current_users + 1 WHERE id = ?', [serviceId]);
  saveDb(db);
}

function decrementUserCount(db, serviceId) {
  db.run('UPDATE services SET current_users = MAX(0, current_users - 1) WHERE id = ?', [serviceId]);
  saveDb(db);
}

function setServiceClosed(db, serviceId) {
  db.run("UPDATE services SET status = 'closed' WHERE id = ?", [serviceId]);
  saveDb(db);
}

// ── Activity log helpers ──

function addActivityLog(db, serviceId, userName, action, detail) {
  db.run(
    'INSERT INTO activity_logs (service_id, user_name, action, detail) VALUES (?, ?, ?, ?)',
    [serviceId, userName, action, detail || null]
  );
  saveDb(db);
}

function getActivityLogs(db, serviceId, userName) {
  let sql = 'SELECT id, service_id, user_name, action, detail, created_at FROM activity_logs WHERE service_id = ?';
  const params = [serviceId];
  if (userName) {
    sql += ' AND user_name = ?';
    params.push(userName);
  }
  sql += ' ORDER BY created_at DESC LIMIT 100';
  const rows = db.exec(sql, params);
  if (!rows.length) return [];
  return rows[0].values.map(([id, sid, uname, action, detail, createdAt]) => ({
    id, serviceId: sid, userName: uname, action, detail, createdAt
  }));
}

module.exports = {
  initDb,
  getDb,
  saveDb,
  // Token
  createToken,
  getToken,
  markTokenUsed,
  expireTokens,
  // Service
  createService,
  startService,
  closeService,
  closeServiceByCode,
  getServiceByToken,
  getServiceByCode,
  getServiceById,
  checkCodeExists,
  incrementUserCount,
  decrementUserCount,
  setServiceClosed,
  // Logs
  addActivityLog,
  getActivityLogs,
};
