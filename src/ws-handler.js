const { v4: uuidv4 } = require('uuid');
const {
  getServiceByCode,
  getServiceById,
  getToken,
  setServiceClosed,
  incrementUserCount,
  decrementUserCount,
  addActivityLog,
} = require('./db');

/** @type {Map<import('ws').WebSocket, ClientInfo>} */
const clients = new Map();
/** @type {Map<string, Set<import('ws').WebSocket>>} */
const services = new Map();

function setupWebSocket(wss, db) {
  wss.on('connection', (ws) => {
    const client = { ws, userId: uuidv4(), isHost: false };
    clients.set(ws, client);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { sendTo(ws, { type: 'error', message: 'Invalid JSON' }); return; }
      handleMessage(client, msg, db);
    });

    ws.on('close', () => { handleDisconnect(client, db); clients.delete(ws); });
    ws.on('error', () => { handleDisconnect(client, db); clients.delete(ws); });
  });
}

function handleMessage(client, msg, db) {
  console.log(`[WS] recv type=${msg.type} clientId=${client.userId} serviceId=${client.serviceId || 'none'}`);
  switch (msg.type) {
    case 'register': handleRegister(client, msg.code, msg.token, db); break;
    case 'join': handleJoin(client, msg.code, msg.username, db); break;
    case 'signal': handleSignal(client, msg.target, msg.payload); break;
    case 'kick': handleKick(client, msg.userId, db); break;
    case 'close': handleClose(client, db); break;
    default:
      console.log(`[WS] broadcast pass-through type=${msg.type} to service ${client.serviceId}, members=${client.serviceId ? services.get(client.serviceId)?.size : 0}`);
      broadcastToService(client.serviceId, msg);
      break;
  }
}

function handleRegister(client, code, token, db) {
  const tokenRecord = getToken(db, token);
  if (!tokenRecord || tokenRecord.status !== 'used' || !tokenRecord.serviceId) {
    console.log('[WS] register FAILED: invalid token', token);
    sendTo(client.ws, { type: 'error', message: 'Invalid token' }); return;
  }
  const service = getServiceById(db, tokenRecord.serviceId);
  if (!service || service.status !== 'active' || service.code !== code) {
    console.log('[WS] register FAILED: service issue', { sid: tokenRecord.serviceId, active: service?.status, code: service?.code, reqCode: code });
    sendTo(client.ws, { type: 'error', message: 'Service not active or code mismatch' }); return;
  }
  client.serviceId = service.id;
  client.isHost = true;
  if (!services.has(service.id)) services.set(service.id, new Set());
  services.get(service.id).add(client.ws);
  console.log(`[WS] register OK serviceId=${service.id} code=${code} members=${services.get(service.id).size}`);
  sendTo(client.ws, { type: 'joined', serviceId: service.id, hostUserId: client.userId });
}

function handleJoin(client, code, username, db) {
  const service = getServiceByCode(db, code);
  if (!service) { console.log('[WS] join FAILED: service not found for code', code); sendTo(client.ws, { type: 'error', message: 'Service not found' }); return; }
  if (service.currentUsers >= service.maxUsers) {
    console.log('[WS] join FAILED: service full', service.serviceId);
    sendTo(client.ws, { type: 'error', message: 'Service is full' }); return;
  }
  client.serviceId = service.serviceId;
  client.username = username;
  if (!services.has(service.serviceId)) services.set(service.serviceId, new Set());
  services.get(service.serviceId).add(client.ws);
  incrementUserCount(db, service.serviceId);
  addActivityLog(db, service.serviceId, username, 'joined');
  console.log(`[WS] join OK serviceId=${service.serviceId} user=${username} members=${services.get(service.serviceId).size}`);
  broadcastToService(service.serviceId, {
    type: 'user-joined',
    user: { userId: client.userId, username },
  }, client.ws);
  sendTo(client.ws, { type: 'joined', serviceId: service.serviceId, hostUserId: '' });
}

function handleSignal(client, target, payload) {
  if (!client.serviceId) return;
  for (const [ws, c] of clients) {
    if (c.userId === target && c.serviceId === client.serviceId) {
      sendTo(ws, { type: 'signal', from: client.userId, payload }); return;
    }
  }
}

function handleKick(client, userId, db) {
  if (!client.isHost || !client.serviceId) return;
  for (const [ws, c] of clients) {
    if (c.userId === userId && c.serviceId === client.serviceId) {
      sendTo(ws, { type: 'kicked' });
      if (c.username) {
        decrementUserCount(db, client.serviceId);
        addActivityLog(db, client.serviceId, c.username, 'kicked');
      }
      services.get(client.serviceId)?.delete(ws);
      broadcastToService(client.serviceId, { type: 'user-left', userId });
      clients.delete(ws); return;
    }
  }
}

function handleClose(client, db) {
  if (!client.isHost || !client.serviceId) return;
  setServiceClosed(db, client.serviceId);
  broadcastToService(client.serviceId, { type: 'host-left' });
  services.get(client.serviceId)?.forEach((ws) => clients.delete(ws));
  services.delete(client.serviceId);
}

function handleDisconnect(client, db) {
  if (!client.serviceId) return;
  services.get(client.serviceId)?.delete(client.ws);
  if (client.isHost) {
    setServiceClosed(db, client.serviceId);
    broadcastToService(client.serviceId, { type: 'host-left' });
    services.get(client.serviceId)?.forEach((ws) => clients.delete(ws));
    services.delete(client.serviceId);
  } else if (client.username) {
    decrementUserCount(db, client.serviceId);
    addActivityLog(db, client.serviceId, client.username, 'left');
    broadcastToService(client.serviceId, { type: 'user-left', userId: client.userId });
  }
}

function sendTo(ws, msg) {
  if (ws.readyState === 1) {
    const client = clients.get(ws);
    console.log(`[WS] sendTo type=${msg.type} -> ${client?.isHost ? 'HOST' : 'joiner'} id=${client?.userId?.slice(0, 8)}`);
    ws.send(JSON.stringify(msg));
  } else {
    console.log(`[WS] sendTo SKIPPED type=${msg.type} readyState=${ws.readyState}`);
  }
}

function broadcastToService(serviceId, msg, exclude) {
  if (!serviceId) { console.log('[WS] broadcastToService SKIPPED — no serviceId'); return; }
  const members = services.get(serviceId);
  if (!members) { console.log('[WS] broadcastToService SKIPPED — no members for service', serviceId.slice(0, 8)); return; }
  console.log(`[WS] broadcastToService type=${msg.type} to ${members.size} members`);
  members.forEach((ws) => { if (ws !== exclude) sendTo(ws, msg); });
}

module.exports = { setupWebSocket };
