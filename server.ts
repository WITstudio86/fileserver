// server.ts
import { createServer, IncomingMessage } from 'http';
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
    handle(req, res, parse(req.url || '', true));
  });

  const wss = new WebSocketServer({ noServer: true });
  setupWebSocket(wss);

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    const { pathname } = parse(request.url || '', true);

    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      // Forward HMR and other WebSocket connections to Next.js
      const nextUpgradeHandler = (app as any).getUpgradeHandler?.();
      if (nextUpgradeHandler) {
        nextUpgradeHandler(request, socket, head);
      } else {
        socket.destroy();
      }
    }
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
