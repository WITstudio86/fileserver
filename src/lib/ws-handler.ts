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
  console.log(`[WS] recv type=${msg.type} clientId=${client.userId} serviceId=${client.serviceId || 'none'}`);
  switch (msg.type) {
    case 'register': handleRegister(client, msg.code, msg.token); break;
    case 'join': handleJoin(client, msg.code, msg.username); break;
    case 'signal': handleSignal(client, msg.target, msg.payload); break;
    case 'kick': handleKick(client, msg.userId); break;
    case 'close': handleClose(client); break;
    default:
      // Pass-through: broadcast file-list, file-request, file-response, file-upload, etc.
      console.log(`[WS] broadcast pass-through type=${msg.type} to service ${client.serviceId}, members=${client.serviceId ? services.get(client.serviceId)?.size : 0}`);
      broadcastToService(client.serviceId, msg as unknown as WsServerMessage);
      break;
  }
}

function handleRegister(client: ClientInfo, code: string, token: string) {
  const tokenRecord = getTokenById(token);
  if (!tokenRecord || tokenRecord.status !== 'used' || !tokenRecord.service_id) {
    console.log('[WS] register FAILED: invalid token', token);
    sendTo(client.ws, { type: 'error', message: 'Invalid token' }); return;
  }
  const service = getServiceById(tokenRecord.service_id);
  if (!service || service.status !== 'active' || service.code !== code) {
    console.log('[WS] register FAILED: service issue', { sid: tokenRecord.service_id, active: service?.status, code: service?.code, reqCode: code });
    sendTo(client.ws, { type: 'error', message: 'Service not active or code mismatch' }); return;
  }
  client.serviceId = service.id;
  client.isHost = true;
  if (!services.has(service.id)) services.set(service.id, new Set());
  services.get(service.id)!.add(client.ws);
  console.log(`[WS] register OK serviceId=${service.id} code=${code} members=${services.get(service.id)!.size}`);
  sendTo(client.ws, { type: 'joined', serviceId: service.id, hostUserId: client.userId });
}

function handleJoin(client: ClientInfo, code: string, username: string) {
  const service = getServiceByCode(code);
  if (!service) { console.log('[WS] join FAILED: service not found for code', code); sendTo(client.ws, { type: 'error', message: 'Service not found' }); return; }
  if (service.current_users >= service.max_users) {
    console.log('[WS] join FAILED: service full', service.id);
    sendTo(client.ws, { type: 'error', message: 'Service is full' }); return;
  }
  client.serviceId = service.id;
  client.username = username;
  if (!services.has(service.id)) services.set(service.id, new Set());
  services.get(service.id)!.add(client.ws);
  incrementUserCount(service.id);
  addActivityLog(service.id, username, 'joined');
  console.log(`[WS] join OK serviceId=${service.id} user=${username} members=${services.get(service.id)!.size}`);
  broadcastToService(service.id, {
    type: 'user-joined',
    user: { userId: client.userId, username },
  }, client.ws);
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

function broadcastToService(serviceId: string | undefined, msg: WsServerMessage, exclude?: WebSocket) {
  if (!serviceId) return;
  services.get(serviceId)?.forEach((ws) => { if (ws !== exclude) sendTo(ws, msg); });
}
