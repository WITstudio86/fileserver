const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { initDb } = require('./src/db');
const { setupWebSocket, downloadBuffers } = require('./src/ws-handler');
const tokenRoutes = require('./src/routes/token');
const serviceRoutes = require('./src/routes/service');
const logsRoutes = require('./src/routes/logs');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  console.log('Initializing database...');
  const db = await initDb();
  console.log('Database ready.');

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // API routes
  app.use('/api/token', tokenRoutes(db));
  app.use('/api/service', serviceRoutes(db));
  app.use('/api/logs', logsRoutes(db));

  // File download endpoint (serves buffered chunks from host)
  app.get('/api/dl/:downloadId', (req, res) => {
    const buf = downloadBuffers.get(req.params.downloadId);
    if (!buf || buf.received < buf.totalChunks) {
      return res.status(404).send('File not found or not ready');
    }
    // Prevent multiple downloads / cleanup issues
    downloadBuffers.delete(req.params.downloadId);
    clearTimeout(buf.timer);

    const total = buf.totalSize;
    res.setHeader('Content-Type', buf.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(buf.name)}`);
    res.setHeader('Content-Length', total);

    // Disable timeout for large file downloads
    req.setTimeout(0);
    res.setTimeout(0);

    // Stream chunks to avoid double-buffering in memory
    let sent = 0;
    for (const chunk of buf.chunks) {
      sent += chunk.length;
      if (sent >= total) {
        const excess = sent - total;
        res.write(excess > 0 ? chunk.subarray(0, chunk.length - excess) : chunk);
      } else {
        res.write(chunk);
      }
    }
    res.end();
    console.log(`[HTTP] download served: ${buf.name} (${(total / 1024 / 1024).toFixed(1)}MB)`);
  });

  // Page routes
  app.get('/service', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'service.html'));
  });
  app.get('/join', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'join.html'));
  });

  const server = http.createServer(app);

  const wss = new WebSocketServer({ noServer: true });
  setupWebSocket(wss, db);

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`> Ready on http://${HOST}:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
