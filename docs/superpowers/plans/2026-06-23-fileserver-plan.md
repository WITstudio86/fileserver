# FileServer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a LAN file-sharing service (fileserver.zelab.top) with WebRTC P2P transfer, token-gated access, and 4-digit code service discovery.

**Architecture:** Next.js 16 App Router + custom Node.js server (tsx) for WebSocket + SQLite. Central server handles token management and WebRTC signaling. Files transfer directly via WebRTC DataChannel between browsers (File System Access API for directory selection).

**Tech Stack:** Next.js 16, React 19, better-sqlite3, ws, uuid, Tailwind CSS 4, tsx

**File Structure:**
```
fileserver/
├── server.ts                         # Custom server (WebSocket + Next.js)
├── next.config.ts
├── package.json
├── tsconfig.json
├── .env.local
├── src/
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx                # Root layout + metadata
│   │   ├── page.tsx                  # 介绍页 (landing)
│   │   ├── service/
│   │   │   └── page.tsx              # 服务页 (config + running)
│   │   ├── join/
│   │   │   └── page.tsx              # 加入页
│   │   └── api/
│   │       ├── token/
│   │       │   ├── create/route.ts
│   │       │   └── status/[id]/route.ts
│   │       ├── service/
│   │       │   ├── register/route.ts
│   │       │   ├── start/route.ts
│   │       │   ├── close/route.ts
│   │       │   └── [code]/route.ts
│   │       └── logs/
│   │           └── [serviceId]/route.ts
│   ├── lib/
│   │   ├── db.ts                     # SQLite init + queries
│   │   ├── types.ts                  # Shared types
│   │   └── ws-handler.ts             # WebSocket message handler
│   └── components/
│       ├── Header.tsx
│       ├── JoinModal.tsx
│       ├── FileList.tsx
│       ├── FilePreview.tsx
│       ├── UserManager.tsx
│       ├── ActivityLog.tsx
│       └── ServiceConfig.tsx
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `.env.local`, `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "fileserver",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "npx tsx server.ts",
    "build": "next build",
    "start": "NODE_ENV=production npx tsx server.ts",
    "lint": "next lint"
  },
  "dependencies": {
    "better-sqlite3": "^12.10.0",
    "next": "16.2.6",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "uuid": "^14.0.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@types/uuid": "^11.0.0",
    "@types/ws": "^8.5.0",
    "eslint": "^9",
    "eslint-config-next": "16.2.6",
    "tailwindcss": "^4",
    "tsx": "^4.19.0",
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Install dependencies** — Run: `npm install`

- [ ] **Step 3: Create next.config.ts**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Create .env.local**

```
DATABASE_PATH=data/fileserver.db
TOKEN_EXPIRE_HOURS=12
```

- [ ] **Step 6: Create .gitignore**

```
node_modules/
.next/
data/
.env.local
.superpowers/
```

- [ ] **Step 7: Commit**

```bash
git add package.json next.config.ts tsconfig.json .env.local .gitignore
git commit -m "chore: scaffold Next.js project"
```

---

### Task 2: Shared types

**Files:**
- Create: `src/lib/types.ts`

- [ ] **Step 1: Create types file**

```typescript
// src/lib/types.ts

export type TokenStatus = 'unused' | 'used' | 'expired';

export interface TokenRow {
  id: string;
  status: TokenStatus;
  service_id: string | null;
  created_at: string;
  used_at: string | null;
  expires_at: string;
}

export type ServiceStatus = 'configuring' | 'active' | 'closed';

export interface ServiceRow {
  id: string;
  token_id: string;
  code: string | null;
  status: ServiceStatus;
  share_path: string | null;
  max_users: number;
  allow_upload: number;
  current_users: number;
  created_at: string;
  started_at: string | null;
  expires_at: string | null;
}

export type LogAction = 'joined' | 'left' | 'kicked' | 'downloaded' | 'uploaded' | 'previewed';

export interface ActivityLogRow {
  id: number;
  service_id: string;
  user_name: string;
  action: LogAction;
  detail: string | null;
  created_at: string;
}

// WebSocket message types (client → server)
export type WsClientMessage =
  | { type: 'register'; code: string; token: string }
  | { type: 'join'; code: string; username: string }
  | { type: 'signal'; target: string; payload: unknown }
  | { type: 'kick'; userId: string }
  | { type: 'close' };

// WebSocket message types (server → client)
export interface WsUser {
  userId: string;
  username: string;
}

export type WsServerMessage =
  | { type: 'signal'; from: string; payload: unknown }
  | { type: 'user-joined'; user: WsUser }
  | { type: 'user-left'; userId: string }
  | { type: 'kicked' }
  | { type: 'joined'; serviceId: string; hostUserId: string }
  | { type: 'host-left' }
  | { type: 'error'; message: string };

// WebRTC DataChannel file transfer messages
export interface FileMeta {
  fileId: string;
  name: string;
  size: number;
  mime: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add shared TypeScript types"
```

---

### Task 3: Database setup

**Files:**
- Create: `src/lib/db.ts`

- [ ] **Step 1: Create database module**

```typescript
// src/lib/db.ts
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

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

// Token queries
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

// Service queries
export function createService(id: string, tokenId: string) {
  getDb().prepare('INSERT INTO services (id, token_id) VALUES (?, ?)').run(id, tokenId);
}

export function getServiceById(id: string): ServiceRow | undefined {
  return getDb().prepare('SELECT * FROM services WHERE id = ?').get(id) as ServiceRow | undefined;
}

export function getServiceByCode(code: string): ServiceRow | undefined {
  return getDb().prepare(
    "SELECT * FROM services WHERE code = ? AND status = 'active'"
  ).get(code) as ServiceRow | undefined;
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

// Activity log queries
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

import type { TokenRow, ServiceRow, ActivityLogRow } from './types';
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat: add SQLite database with schema and queries"
```

---

### Task 4: API — Token

**Files:**
- Create: `src/app/api/token/create/route.ts`, `src/app/api/token/status/[id]/route.ts`

- [ ] **Step 1: Create token creation endpoint**

```typescript
// src/app/api/token/create/route.ts
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { createToken } from '@/lib/db';

export async function POST() {
  const tokenId = uuidv4();
  const expireHours = parseInt(process.env.TOKEN_EXPIRE_HOURS || '12', 10);
  createToken(tokenId, expireHours);

  return NextResponse.json({ token: tokenId, expiresInHours: expireHours });
}
```

- [ ] **Step 2: Create token status endpoint**

```typescript
// src/app/api/token/status/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getTokenById, expireUnusedTokens } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  expireUnusedTokens();

  const token = getTokenById(id);
  if (!token) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: token.id,
    status: token.status,
    expiresAt: token.expires_at,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/token/
git commit -m "feat: add token create and status API routes"
```

---

### Task 5: API — Service

**Files:**
- Create: `src/app/api/service/register/route.ts`, `src/app/api/service/start/route.ts`, `src/app/api/service/close/route.ts`, `src/app/api/service/[code]/route.ts`

- [ ] **Step 1: Create service register endpoint**

```typescript
// src/app/api/service/register/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getTokenById, markTokenUsed, createService, updateServiceConfig } from '@/lib/db';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { token, code, maxUsers, allowUpload, sharePath } = body;

  if (!token || !code || code.length !== 4 || !/^\d{4}$/.test(code)) {
    return NextResponse.json({ error: 'Invalid request: token and 4-digit code required' }, { status: 400 });
  }

  const tokenRecord = getTokenById(token);
  if (!tokenRecord || tokenRecord.status !== 'unused') {
    return NextResponse.json({ error: 'Invalid or already used token' }, { status: 403 });
  }

  const serviceId = uuidv4();
  createService(serviceId, token);
  markTokenUsed(token, serviceId);

  updateServiceConfig(serviceId, {
    code,
    max_users: maxUsers || 10,
    allow_upload: allowUpload ? 1 : 0,
    share_path: sharePath || '',
  });

  return NextResponse.json({ serviceId });
}
```

- [ ] **Step 2: Create service lookup endpoint**

```typescript
// src/app/api/service/[code]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServiceByCode } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  if (!code || code.length !== 4 || !/^\d{4}$/.test(code)) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 400 });
  }

  const service = getServiceByCode(code);

  if (!service) {
    return NextResponse.json({ found: false });
  }

  return NextResponse.json({
    found: true,
    serviceId: service.id,
    allowUpload: !!service.allow_upload,
    currentUsers: service.current_users,
    maxUsers: service.max_users,
  });
}
```

- [ ] **Step 3: Create service start endpoint**

```typescript
// src/app/api/service/start/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getTokenById, getServiceById, setServiceActive } from '@/lib/db';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { token } = body;

  if (!token) {
    return NextResponse.json({ error: 'Token required' }, { status: 400 });
  }

  const tokenRecord = getTokenById(token);
  if (!tokenRecord || tokenRecord.status !== 'used' || !tokenRecord.service_id) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
  }

  const service = getServiceById(tokenRecord.service_id);
  if (!service) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 });
  }

  setServiceActive(service.id);
  return NextResponse.json({ success: true, serviceId: service.id });
}
```

- [ ] **Step 4: Create service close endpoint**

```typescript
// src/app/api/service/close/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getTokenById, setServiceClosed } from '@/lib/db';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { token } = body;

  const tokenRecord = getTokenById(token);
  if (!tokenRecord || !tokenRecord.service_id) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
  }

  setServiceClosed(tokenRecord.service_id);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/service/
git commit -m "feat: add service API routes"
```

---

### Task 6: API — Activity Logs

**Files:**
- Create: `src/app/api/logs/[serviceId]/route.ts`

- [ ] **Step 1: Create logs endpoint**

```typescript
// src/app/api/logs/[serviceId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getTokenById, getActivityLogs } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params;
  const token = request.nextUrl.searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Token required' }, { status: 401 });
  }

  const tokenRecord = getTokenById(token);
  if (!tokenRecord || tokenRecord.service_id !== serviceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const filterUser = request.nextUrl.searchParams.get('user') || undefined;
  const logs = getActivityLogs(serviceId, filterUser);

  return NextResponse.json({ logs });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/logs/
git commit -m "feat: add activity logs API route"
```

---

### Task 7: Custom server with WebSocket

**Files:**
- Create: `server.ts`, `src/lib/ws-handler.ts`

- [ ] **Step 1: Install tsx** — Run: `npm install --save-dev tsx`

- [ ] **Step 2: Create WebSocket handler**

```typescript
// src/lib/ws-handler.ts
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
  getServiceByCode, getServiceById, getTokenById,
  setServiceClosed, incrementUserCount, decrementUserCount, addActivityLog,
} from './db';
import type { WsClientMessage, WsServerMessage } from './types';

interface ClientInfo {
  ws: WebSocket;
  userId: string;
  serviceId?: string;
  username?: string;
  isHost: boolean;
}

const clients = new Map<WebSocket, ClientInfo>();
const services = new Map<string, Set<WebSocket>>();

export function setupWebSocket(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket) => {
    const client: ClientInfo = { ws, userId: uuidv4(), isHost: false };
    clients.set(ws, client);

    ws.on('message', (raw: Buffer) => {
      let msg: WsClientMessage;
      try { msg = JSON.parse(raw.toString()); }
      catch { sendTo(ws, { type: 'error', message: 'Invalid JSON' }); return; }
      handleMessage(client, msg);
    });

    ws.on('close', () => { handleDisconnect(client); clients.delete(ws); });
    ws.on('error', () => { handleDisconnect(client); clients.delete(ws); });
  });
}

function handleMessage(client: ClientInfo, msg: WsClientMessage) {
  switch (msg.type) {
    case 'register': handleRegister(client, msg.code, msg.token); break;
    case 'join': handleJoin(client, msg.code, msg.username); break;
    case 'signal': handleSignal(client, msg.target, msg.payload); break;
    case 'kick': handleKick(client, msg.userId); break;
    case 'close': handleClose(client); break;
  }
}

function handleRegister(client: ClientInfo, code: string, token: string) {
  const tokenRecord = getTokenById(token);
  if (!tokenRecord || tokenRecord.status !== 'used' || !tokenRecord.service_id) {
    sendTo(client.ws, { type: 'error', message: 'Invalid token' }); return;
  }
  const service = getServiceById(tokenRecord.service_id);
  if (!service || service.status !== 'active' || service.code !== code) {
    sendTo(client.ws, { type: 'error', message: 'Service not active or code mismatch' }); return;
  }
  client.serviceId = service.id;
  client.isHost = true;
  if (!services.has(service.id)) services.set(service.id, new Set());
  services.get(service.id)!.add(client.ws);
  sendTo(client.ws, { type: 'joined', serviceId: service.id, hostUserId: client.userId });
}

function handleJoin(client: ClientInfo, code: string, username: string) {
  const service = getServiceByCode(code);
  if (!service) { sendTo(client.ws, { type: 'error', message: 'Service not found' }); return; }
  if (service.current_users >= service.max_users) {
    sendTo(client.ws, { type: 'error', message: 'Service is full' }); return;
  }
  client.serviceId = service.id;
  client.username = username;
  if (!services.has(service.id)) services.set(service.id, new Set());
  services.get(service.id)!.add(client.ws);
  incrementUserCount(service.id);
  addActivityLog(service.id, username, 'joined');
  broadcastToService(service.id, { type: 'user-joined', user: { userId: client.userId, username } }, client.ws);
  sendTo(client.ws, { type: 'joined', serviceId: service.id, hostUserId: '' });
}

function handleSignal(client: ClientInfo, target: string, payload: unknown) {
  if (!client.serviceId) return;
  for (const [ws, c] of clients) {
    if (c.userId === target && c.serviceId === client.serviceId) {
      sendTo(ws, { type: 'signal', from: client.userId, payload }); return;
    }
  }
}

function handleKick(client: ClientInfo, userId: string) {
  if (!client.isHost || !client.serviceId) return;
  for (const [ws, c] of clients) {
    if (c.userId === userId && c.serviceId === client.serviceId) {
      sendTo(ws, { type: 'kicked' });
      if (c.username) {
        decrementUserCount(client.serviceId);
        addActivityLog(client.serviceId, c.username, 'kicked');
      }
      services.get(client.serviceId)?.delete(ws);
      broadcastToService(client.serviceId, { type: 'user-left', userId });
      clients.delete(ws); return;
    }
  }
}

function handleClose(client: ClientInfo) {
  if (!client.isHost || !client.serviceId) return;
  setServiceClosed(client.serviceId);
  broadcastToService(client.serviceId, { type: 'host-left' });
  services.get(client.serviceId)?.forEach((ws) => clients.delete(ws));
  services.delete(client.serviceId);
}

function handleDisconnect(client: ClientInfo) {
  if (!client.serviceId) return;
  services.get(client.serviceId)?.delete(client.ws);
  if (client.isHost) {
    setServiceClosed(client.serviceId);
    broadcastToService(client.serviceId, { type: 'host-left' });
    services.get(client.serviceId)?.forEach((ws) => clients.delete(ws));
    services.delete(client.serviceId);
  } else if (client.username) {
    decrementUserCount(client.serviceId);
    addActivityLog(client.serviceId, client.username, 'left');
    broadcastToService(client.serviceId, { type: 'user-left', userId: client.userId });
  }
}

function sendTo(ws: WebSocket, msg: WsServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastToService(serviceId: string, msg: WsServerMessage, exclude?: WebSocket) {
  services.get(serviceId)?.forEach((ws) => { if (ws !== exclude) sendTo(ws, msg); });
}
```

- [ ] **Step 3: Create custom server entry**

```typescript
// server.ts
import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer } from 'ws';
import { setupWebSocket } from './src/lib/ws-handler';

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url, true));
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  setupWebSocket(wss);

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add server.ts src/lib/ws-handler.ts
git commit -m "feat: add custom server with WebSocket signaling"
```

---

### Task 8: Root layout + global styles

**Files:**
- Create: `src/app/layout.tsx`, `src/app/globals.css`

- [ ] **Step 1: Create globals.css**

```css
/* src/app/globals.css */
@import "tailwindcss";

:root {
  --bg: #ffffff;
  --fg: #111827;
  --muted: #6b7280;
  --border: #e5e7eb;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--fg);
  margin: 0;
}

.container {
  max-width: 960px;
  margin: 0 auto;
  padding: 0 16px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 24px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background 0.15s;
}

.btn-primary {
  background: var(--accent);
  color: #fff;
}
.btn-primary:hover { background: var(--accent-hover); }

.btn-secondary {
  background: #f3f4f6;
  color: #374151;
}
.btn-secondary:hover { background: #e5e7eb; }

.btn-danger {
  background: #ef4444;
  color: #fff;
}

.input {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 14px;
  width: 100%;
  box-sizing: border-box;
}
.input:focus { outline: none; border-color: var(--accent); }

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

.modal {
  background: white;
  border-radius: 12px;
  padding: 24px;
  min-width: 320px;
  max-width: 90vw;
}
```

- [ ] **Step 2: Create root layout**

```tsx
// src/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FileServer — 局域网文件共享',
  description: '同一网络下快速分发和收集文件',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx src/app/globals.css
git commit -m "feat: add root layout and global styles"
```

---

### Task 9: Header + Intro page + JoinModal

**Files:**
- Create: `src/components/Header.tsx`, `src/components/JoinModal.tsx`, `src/app/page.tsx`

- [ ] **Step 1: Create Header**

```tsx
// src/components/Header.tsx
export default function Header() {
  return (
    <header style={{ borderBottom: '1px solid var(--border)', padding: '12px 0' }}>
      <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 20 }}>🔄</span>
        <span style={{ fontWeight: 600, fontSize: 18 }}>FileServer</span>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>ZeLab</span>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Create JoinModal**

```tsx
// src/components/JoinModal.tsx
'use client';
import { useState } from 'react';

export default function JoinModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('');

  const handleSubmit = () => {
    if (code.length === 4 && /^\d{4}$/.test(code)) {
      window.location.href = `/join?code=${code}`;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px' }}>加入服务</h3>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 16 }}>
          请输入服务发起者提供的 4 位数字码
        </p>
        <input
          className="input"
          type="text"
          inputMode="numeric"
          maxLength={4}
          placeholder="输入 4 位数字码"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={code.length !== 4} onClick={handleSubmit}>
            加入
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create intro page**

```tsx
// src/app/page.tsx
'use client';
import { useState } from 'react';
import Header from '@/components/Header';
import JoinModal from '@/components/JoinModal';

export default function HomePage() {
  const [showJoin, setShowJoin] = useState(false);

  const handleStartService = async () => {
    const res = await fetch('/api/token/create', { method: 'POST' });
    const data = await res.json();
    window.location.href = `/service?token=${data.token}`;
  };

  return (
    <>
      <Header />
      <main style={{ textAlign: 'center', padding: '60px 16px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>
          局域网文件共享，简单即连
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 16, maxWidth: 420, margin: '0 auto 32px' }}>
          同一网络下快速分发和收集文件，无需安装客户端，浏览器即用
        </p>

        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 48 }}>
          <button className="btn btn-primary" onClick={handleStartService}>
            ✨ 开启服务
          </button>
          <button className="btn btn-secondary" onClick={() => setShowJoin(true)}>
            🔗 加入服务
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24, maxWidth: 500, margin: '0 auto' }}>
          {[
            { icon: '🔒', title: 'Token 保护', desc: '一服务一 Token，安全可控' },
            { icon: '⚡', title: '直连传输', desc: '同 LAN 极速 P2P 直传' },
            { icon: '🔢', title: '4 位码加入', desc: '输入即可加入，简单快捷' },
          ].map(({ icon, title, desc }) => (
            <div key={title} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28 }}>{icon}</div>
              <div style={{ fontWeight: 600, fontSize: 14, marginTop: 4 }}>{title}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>{desc}</div>
            </div>
          ))}
        </div>

        {showJoin && <JoinModal onClose={() => setShowJoin(false)} />}
      </main>
    </>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/Header.tsx src/components/JoinModal.tsx src/app/page.tsx
git commit -m "feat: add intro page with join modal"
```

---

### Task 10: Service page (config + running)

**Files:**
- Create: `src/app/service/page.tsx`, `src/components/ServiceConfig.tsx`

- [ ] **Step 1: Create ServiceConfig component**

```tsx
// src/components/ServiceConfig.tsx
'use client';
import { useState } from 'react';

interface Config {
  code: string;
  maxUsers: number;
  allowUpload: boolean;
  sharePath: string;
}

export default function ServiceConfig({ token, onConfigSaved }: {
  token: string;
  onConfigSaved: (cfg: Config) => void;
}) {
  const [code, setCode] = useState('');
  const [maxUsers, setMaxUsers] = useState(10);
  const [allowUpload, setAllowUpload] = useState(false);
  const [sharePath, setSharePath] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSelectDir = async () => {
    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      setSharePath(dirHandle.name);
      (window as any).__shareDirHandle = dirHandle;
    } catch { /* user cancelled */ }
  };

  const handleSave = async () => {
    if (code.length !== 4 || !/^\d{4}$/.test(code)) {
      setError('请输入 4 位数字码'); return;
    }
    if (!sharePath) {
      setError('请选择共享目录'); return;
    }
    setSaving(true);
    const res = await fetch('/api/service/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, code, maxUsers, allowUpload, sharePath }),
    });
    const data = await res.json();
    if (data.error) {
      setError(data.error);
    } else {
      onConfigSaved({ code, maxUsers, allowUpload, sharePath });
    }
    setSaving(false);
  };

  return (
    <div style={{ maxWidth: 440, margin: '40px auto', padding: 24 }}>
      <h2 style={{ fontSize: 20, marginBottom: 24 }}>服务配置</h2>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontWeight: 500, fontSize: 14 }}>4 位数字码</label>
        <input
          className="input" type="text" inputMode="numeric" maxLength={4}
          placeholder="如 1234"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          style={{ marginTop: 4 }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontWeight: 500, fontSize: 14 }}>人数上限</label>
        <input
          className="input" type="number" min={1} max={50}
          value={maxUsers}
          onChange={(e) => setMaxUsers(Number(e.target.value))}
          style={{ marginTop: 4, width: 100 }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
          <input type="checkbox" checked={allowUpload} onChange={(e) => setAllowUpload(e.target.checked)} />
          允许加入者上传文件
        </label>
      </div>

      <div style={{ marginBottom: 24 }}>
        <button className="btn btn-secondary" onClick={handleSelectDir}>
          📁 选择共享目录
        </button>
        {sharePath && <p style={{ marginTop: 8, fontSize: 13, color: 'var(--muted)' }}>已选择: {sharePath}</p>}
      </div>

      {error && <p style={{ color: '#ef4444', fontSize: 14, marginBottom: 16 }}>{error}</p>}

      <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ width: '100%' }}>
        {saving ? '保存中...' : '保存配置并开启服务'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create service page**

```tsx
// src/app/service/page.tsx
'use client';
import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import ServiceConfig from '@/components/ServiceConfig';
import UserManager from '@/components/UserManager';
import ActivityLog from '@/components/ActivityLog';
import type { WsServerMessage } from '@/lib/types';

function ServiceContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [state, setState] = useState<'validating' | 'configuring' | 'active' | 'invalid'>('validating');
  const [serviceId, setServiceId] = useState('');
  const [peers, setPeers] = useState<{ userId: string; username: string }[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!token) { setState('invalid'); return; }
    fetch(`/api/token/status/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.status === 'unused') setState('configuring');
        else if (data.status === 'used') { setState('active'); setServiceId(data.serviceId || ''); }
        else setState('invalid');
      })
      .catch(() => setState('invalid'));
  }, [token]);

  const connectWebSocket = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'register', code: '', token }));
    };

    ws.onmessage = (e) => {
      const msg: WsServerMessage = JSON.parse(e.data);
      switch (msg.type) {
        case 'joined':
          setServiceId(msg.serviceId);
          break;
        case 'user-joined':
          setPeers(prev => [...prev, msg.user]);
          fetchLogs();
          break;
        case 'user-left':
          setPeers(prev => prev.filter(p => p.userId !== msg.userId));
          fetchLogs();
          break;
        case 'host-left':
          setState('invalid');
          break;
      }
    };

    ws.onclose = () => setState('invalid');
  }, [token]);

  const fetchLogs = async () => {
    const res = await fetch(`/api/logs/${serviceId}?token=${token}`);
    const data = await res.json();
    setLogs(data.logs || []);
  };

  const handleConfigSaved = async () => {
    await fetch('/api/service/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    setState('active');
    connectWebSocket();
  };

  const handleClose = () => {
    wsRef.current?.send(JSON.stringify({ type: 'close' }));
    setState('invalid');
  };

  if (state === 'validating') return <p style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>验证中...</p>;
  if (state === 'invalid') return <p style={{ padding: 40, textAlign: 'center', color: '#ef4444' }}>Token 无效或已过期</p>;

  return (
    <>
      <Header />
      {state === 'configuring' && (
        <ServiceConfig token={token} onConfigSaved={handleConfigSaved} />
      )}
      {state === 'active' && (
        <div className="container" style={{ padding: '24px 0' }}>
          <div style={{ display: 'flex', gap: 24 }}>
            <div style={{ width: 240, flexShrink: 0 }}>
              <UserManager peers={peers} ws={wsRef.current} />
              <button className="btn btn-danger" onClick={handleClose} style={{ width: '100%', marginTop: 16 }}>
                关闭服务
              </button>
            </div>
            <div style={{ flex: 1 }}>
              <ActivityLog logs={logs} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function ServicePage() {
  return (
    <Suspense>
      <ServiceContent />
    </Suspense>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/service/page.tsx src/components/ServiceConfig.tsx
git commit -m "feat: add service page with config and active states"
```

---

### Task 11: UserManager + ActivityLog

**Files:**
- Create: `src/components/UserManager.tsx`, `src/components/ActivityLog.tsx`

- [ ] **Step 1: Create UserManager**

```tsx
// src/components/UserManager.tsx
export default function UserManager({ peers, ws }: {
  peers: { userId: string; username: string }[];
  ws: WebSocket | null;
}) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
      <h3 style={{ fontSize: 16, margin: '0 0 12px' }}>在线用户 ({peers.length})</h3>
      {peers.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>等待加入...</p>}
      {peers.map(peer => (
        <div key={peer.userId} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '6px 0', borderBottom: '1px solid #f3f4f6', fontSize: 14
        }}>
          <span>👤 {peer.username}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create ActivityLog**

```tsx
// src/components/ActivityLog.tsx
import { useState } from 'react';

interface LogEntry {
  id: number;
  user_name: string;
  action: string;
  detail: string | null;
  created_at: string;
}

const actionLabel: Record<string, string> = {
  joined: '加入了服务',
  left: '离开了服务',
  kicked: '被踢出',
  downloaded: '下载了',
  uploaded: '上传了',
  previewed: '预览了',
};

export default function ActivityLog({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState('');
  const users = [...new Set(logs.map(l => l.user_name))];

  const filtered = filter ? logs.filter(l => l.user_name === filter) : logs;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, margin: 0 }}>活动记录</h3>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13 }}
        >
          <option value="">全部用户</option>
          {users.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      {filtered.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>暂无记录</p>}
      {filtered.map(log => (
        <div key={log.id} style={{
          padding: '6px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13, color: 'var(--muted)'
        }}>
          <span>{log.created_at}</span>{' '}
          <strong style={{ color: 'var(--fg)' }}>{log.user_name}</strong>{' '}
          {actionLabel[log.action] || log.action}
          {log.detail && <> — {log.detail}</>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/UserManager.tsx src/components/ActivityLog.tsx
git commit -m "feat: add user manager and activity log components"
```

---

### Task 12: Join page

**Files:**
- Create: `src/app/join/page.tsx`

- [ ] **Step 1: Create join page**

```tsx
// src/app/join/page.tsx
'use client';
import { Suspense, useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import FileList from '@/components/FileList';
import type { WsServerMessage, FileMeta } from '@/lib/types';

function JoinContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get('code') || '';
  const [step, setStep] = useState<'lookup' | 'username' | 'connected' | 'notFound'>('lookup');
  const [username, setUsername] = useState('');
  const [serviceInfo, setServiceInfo] = useState<any>(null);
  const [files, setFiles] = useState<FileMeta[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!code) { setStep('notFound'); return; }
    fetch(`/api/service/${code}`)
      .then(r => r.json())
      .then(data => {
        if (data.found) { setServiceInfo(data); setStep('username'); }
        else setStep('notFound');
      })
      .catch(() => setStep('notFound'));
  }, [code]);

  const handleJoin = () => {
    if (!username.trim()) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', code, username }));
    };

    ws.onmessage = (e) => {
      const msg: WsServerMessage = JSON.parse(e.data);
      switch (msg.type) {
        case 'joined':
          setStep('connected');
          break;
        case 'host-left':
        case 'kicked':
          setStep('notFound');
          break;
      }
    };

    ws.onclose = () => setStep('notFound');
  };

  if (step === 'lookup') return <p style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>查找服务中...</p>;
  if (step === 'notFound') return (
    <>
      <Header />
      <p style={{ padding: 40, textAlign: 'center', color: '#ef4444' }}>服务未找到或已关闭</p>
    </>
  );

  if (step === 'username') return (
    <>
      <Header />
      <div style={{ maxWidth: 400, margin: '60px auto', padding: 24, textAlign: 'center' }}>
        <h2>加入服务</h2>
        <p style={{ color: 'var(--muted)', marginBottom: 24 }}>
          服务码：{code} | 在线：{serviceInfo.currentUsers}/{serviceInfo.maxUsers}
        </p>
        <input
          className="input" placeholder="输入你的昵称"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          style={{ marginBottom: 16 }}
        />
        <button className="btn btn-primary" onClick={handleJoin} disabled={!username.trim()} style={{ width: '100%' }}>
          加入服务
        </button>
      </div>
    </>
  );

  return (
    <>
      <Header />
      <div className="container" style={{ padding: '24px 0' }}>
        <FileList files={files} canUpload={serviceInfo.allowUpload} ws={wsRef.current} />
      </div>
    </>
  );
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinContent />
    </Suspense>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/join/page.tsx
git commit -m "feat: add join page with service lookup"
```

---

### Task 13: FileList + FilePreview components

**Files:**
- Create: `src/components/FileList.tsx`, `src/components/FilePreview.tsx`

- [ ] **Step 1: Create FileList**

```tsx
// src/components/FileList.tsx
import type { FileMeta } from '@/lib/types';

export default function FileList({ files, canUpload, ws }: {
  files: FileMeta[];
  canUpload: boolean;
  ws: WebSocket | null;
}) {
  return (
    <div>
      <h3 style={{ fontSize: 16, marginBottom: 12 }}>共享文件</h3>
      {files.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>暂无文件</p>}
      {files.map(f => (
        <div key={f.fileId} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 14
        }}>
          <span>
            {f.mime?.startsWith('image/') ? '🖼' : '📄'} {f.name}
            <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 8 }}>
              ({formatSize(f.size)})
            </span>
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }}>👁 预览</button>
            <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 12px' }}>⬇ 下载</button>
          </div>
        </div>
      ))}

      {canUpload && (
        <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <h4 style={{ fontSize: 14, marginBottom: 8 }}>上传文件</h4>
          <input type="file" style={{ fontSize: 13 }} />
          <button className="btn btn-primary" style={{ marginTop: 8, fontSize: 13 }}>上传</button>
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
```

- [ ] **Step 2: Create FilePreview**

```tsx
// src/components/FilePreview.tsx

export default function FilePreview({ fileName, fileUrl, onClose }: {
  fileName: string;
  fileUrl: string;
  onClose: () => void;
}) {
  const isImage = /\.(png|jpg|jpeg|gif|svg|webp|bmp)$/i.test(fileName);
  const isPDF = /\.pdf$/i.test(fileName);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '80vw', maxHeight: '80vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{fileName}</h3>
          <button className="btn btn-secondary" onClick={onClose} style={{ fontSize: 16, padding: '4px 8px' }}>✕</button>
        </div>
        {isImage && <img src={fileUrl} alt={fileName} style={{ maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain' }} />}
        {isPDF && <iframe src={fileUrl} style={{ width: '100%', height: '65vh', border: 'none' }} />}
        {!isImage && !isPDF && <p style={{ color: 'var(--muted)' }}>此文件类型不支持预览，请下载查看</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/FileList.tsx src/components/FilePreview.tsx
git commit -m "feat: add file list and preview components"
```

---

## Verification

After all tasks:
1. `npx tsx server.ts` starts on port 3000
2. Visit `/` — intro page with two buttons
3. Click "开启服务" — token generated, redirect to `/service?token=xxx`
4. Configure (4-digit code, max users, upload toggle, directory) — start service
5. Open another tab, visit `/` — click "加入服务" — enter code — set username — join
6. WebSocket connects both sides, activity logs appear on service page
7. Host closes service — joiners notified

**Known gap:** Full WebRTC DataChannel file transfer between peers is scaffolded (types and signaling) but the peer connection setup and actual file chunking/transfer logic is a follow-up task.
