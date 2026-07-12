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

// Download buffer: server-side file assembly for HTTP download
// Key = downloadId, Value = { name, mime, totalSize, totalChunks, chunks: Buffer[], received, timer, serviceId }
const downloadBuffers = new Map();
const DOWNLOAD_TTL = 10 * 60 * 1000; // auto-clean after 10 min of INACTIVITY

// Track which joiner requested which download
const pendingRequests = new Map(); // requestId → requesterUserId
const downloadOwners = new Map();  // downloadId → requesterUserId

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
    case 'ping': sendTo(client.ws, { type: 'pong' }); break;
    case 'chat-message': broadcastToService(client.serviceId, msg); break;
    case 'file-request':
      // Joiner → Server: track who requested, then forward to host
      if (msg.requestId) {
        pendingRequests.set(msg.requestId, client.userId);
        console.log(`[DL] REQUEST fileId="${msg.fileId}" requestId=${msg.requestId} by userId=${client.userId.slice(0,8)}`);
      }
      broadcastToService(client.serviceId, msg, client.ws); // exclude sender (joiner), only send to host
      break;

    case 'file-response-start':
      // Host → Server: start buffering file for HTTP download
      (() => {
        // Map this download to the requester
        const requesterUserId = msg.requestId ? pendingRequests.get(msg.requestId) : null;
        if (msg.requestId) pendingRequests.delete(msg.requestId);
        downloadOwners.set(msg.downloadId, requesterUserId);

        console.log(`[DL] START downloadId=${msg.downloadId} name="${msg.name}" size=${(msg.totalSize/1024/1024).toFixed(1)}MB chunks=${msg.totalChunks} owner=${requesterUserId ? requesterUserId.slice(0,8) : 'ALL'}`);

        downloadBuffers.set(msg.downloadId, {
          name: msg.name,
          mime: msg.mime,
          totalSize: msg.totalSize,
          totalChunks: msg.totalChunks,
          chunks: new Array(msg.totalChunks),
          received: 0,
          serviceId: client.serviceId,
          timer: setTimeout(() => { downloadBuffers.delete(msg.downloadId); downloadOwners.delete(msg.downloadId); }, DOWNLOAD_TTL),
        });

        // Send progress ONLY to the requester
        const progressMsg = {
          type: 'download-progress',
          downloadId: msg.downloadId,
          name: msg.name,
          size: msg.totalSize,
          received: 0,
          total: msg.totalChunks,
        };
        if (requesterUserId) {
          sendToUser(client.serviceId, requesterUserId, progressMsg);
        }
      })();
      break;

    case 'file-chunk':
      // Host → Server: receive chunk, buffer it
      (() => {
        const buf = downloadBuffers.get(msg.downloadId);
        if (!buf) { console.log(`[DL] chunk for unknown downloadId=${msg.downloadId}, ignoring`); return; }
        buf.chunks[msg.chunkIndex] = Buffer.from(msg.data, 'base64');
        buf.received++;
        if (buf.received === 1 || buf.received % 50 === 0) {
          console.log(`[DL] chunk ${buf.received}/${buf.totalChunks} downloadId=${msg.downloadId}`);
        }
        // Reset inactivity timer on each chunk
        clearTimeout(buf.timer);
        buf.timer = setTimeout(() => { downloadBuffers.delete(msg.downloadId); downloadOwners.delete(msg.downloadId); }, DOWNLOAD_TTL);

        // Send progress ONLY to the requester
        const ownerUserId = downloadOwners.get(msg.downloadId);
        const progressMsg = {
          type: 'download-progress',
          downloadId: msg.downloadId,
          name: buf.name,
          size: buf.totalSize,
          received: buf.received,
          total: buf.totalChunks,
        };
        if (ownerUserId) {
          sendToUser(client.serviceId, ownerUserId, progressMsg);
        }

        if (buf.received === buf.totalChunks) {
          clearTimeout(buf.timer);
          console.log(`[DL] COMPLETE downloadId=${msg.downloadId} name="${buf.name}"`);
          // Send download-ready ONLY to the requester
          const readyMsg = {
            type: 'download-ready',
            downloadId: msg.downloadId,
            name: buf.name,
            size: buf.totalSize,
            mime: buf.mime,
          };
          if (ownerUserId) {
            sendToUser(client.serviceId, ownerUserId, readyMsg);
          }
          downloadOwners.delete(msg.downloadId);
        }
      })();
      break;

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
    // Clean up download buffers for this host's service
    for (const [id, buf] of downloadBuffers) {
      if (buf.serviceId === client.serviceId) {
        clearTimeout(buf.timer);
        downloadBuffers.delete(id);
      }
    }
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

/** Send a message to a specific user within a service by userId */
function sendToUser(serviceId, userId, msg) {
  const members = services.get(serviceId);
  if (!members) return;
  for (const ws of members) {
    const c = clients.get(ws);
    if (c && c.userId === userId) {
      sendTo(ws, msg);
      return;
    }
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

module.exports = { setupWebSocket, downloadBuffers };
