// src/lib/db.ts
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { TokenRow, ServiceRow, ActivityLogRow } from './types';

const DB_PATH = process.env.DATABASE_PATH || 'data/fileserver.db';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'unused',
      service_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      used_at TEXT,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (service_id) REFERENCES services(id)
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
      expires_at TEXT,
      FOREIGN KEY (token_id) REFERENCES tokens(id)
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (service_id) REFERENCES services(id)
    );
  `);
}

export function createToken(id: string, expiresInHours: number = 12) {
  getDb().prepare(
    `INSERT INTO tokens (id, status, expires_at) VALUES (?, 'unused', datetime('now', ?))`
  ).run(id, `+${expiresInHours} hours`);
}

export function getTokenById(id: string): TokenRow | undefined {
  return getDb().prepare('SELECT * FROM tokens WHERE id = ?').get(id) as TokenRow | undefined;
}

export function markTokenUsed(tokenId: string, serviceId: string) {
  getDb().prepare(
    "UPDATE tokens SET status = 'used', service_id = ?, used_at = datetime('now') WHERE id = ?"
  ).run(serviceId, tokenId);
}

export function expireUnusedTokens() {
  getDb().prepare(
    "UPDATE tokens SET status = 'expired' WHERE status = 'unused' AND expires_at < datetime('now')"
  ).run();
}

export function createService(id: string, tokenId: string) {
  getDb().prepare('INSERT INTO services (id, token_id) VALUES (?, ?)').run(id, tokenId);
}

export function getServiceById(id: string): ServiceRow | undefined {
  return getDb().prepare('SELECT * FROM services WHERE id = ?').get(id) as ServiceRow | undefined;
}

export function getServiceByCode(code: string): ServiceRow | undefined {
  return getDb().prepare(
    "SELECT * FROM services WHERE code = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
  ).get(code) as ServiceRow | undefined;
}

export function isCodeInUse(code: string): boolean {
  const row = getDb().prepare(
    "SELECT 1 FROM services WHERE code = ? AND status IN ('configuring', 'active') LIMIT 1"
  ).get(code);
  return !!row;
}

export function updateServiceConfig(
  id: string, data: { code: string; max_users: number; allow_upload: number; share_path: string }
) {
  getDb().prepare(
    'UPDATE services SET code = ?, max_users = ?, allow_upload = ?, share_path = ? WHERE id = ?'
  ).run(data.code, data.max_users, data.allow_upload, data.share_path, id);
}

export function setServiceActive(id: string) {
  getDb().prepare(
    "UPDATE services SET status = 'active', started_at = datetime('now') WHERE id = ?"
  ).run(id);
}

export function setServiceClosed(id: string) {
  getDb().prepare("UPDATE services SET status = 'closed' WHERE id = ?").run(id);
}

export function incrementUserCount(serviceId: string) {
  getDb().prepare('UPDATE services SET current_users = current_users + 1 WHERE id = ?').run(serviceId);
}

export function decrementUserCount(serviceId: string) {
  getDb().prepare('UPDATE services SET current_users = MAX(current_users - 1, 0) WHERE id = ?').run(serviceId);
}

export function addActivityLog(serviceId: string, userName: string, action: string, detail: string | null = null) {
  getDb().prepare(
    'INSERT INTO activity_logs (service_id, user_name, action, detail) VALUES (?, ?, ?, ?)'
  ).run(serviceId, userName, action, detail);
}

export function getActivityLogs(serviceId: string, filterUser?: string): ActivityLogRow[] {
  if (filterUser) {
    return getDb().prepare(
      'SELECT * FROM activity_logs WHERE service_id = ? AND user_name = ? ORDER BY created_at DESC LIMIT 100'
    ).all(serviceId, filterUser) as ActivityLogRow[];
  }
  return getDb().prepare(
    'SELECT * FROM activity_logs WHERE service_id = ? ORDER BY created_at DESC LIMIT 100'
  ).all(serviceId) as ActivityLogRow[];
}
