import 'dotenv/config';
import http from 'http';
import { createHTTPHandler } from '@trpc/server/adapters/standalone';
import { appRouter } from './router';
import cors from 'cors';
import { RelayPushHub } from './relay-hub';

const PORT = Number(process.env.PORT) || 4001;
const RELAY_PUSH_TOKEN = (process.env.EKYBOT_RELAY_PUSH_TOKEN || '').trim();
const relayHub = new RelayPushHub();

console.log('🦅 Ekybot API Server');
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('Port:', PORT);

const corsMiddleware = cors();
const trpcHandler = createHTTPHandler({
  router: appRouter,
});

const server = http.createServer((req, res) => {
  corsMiddleware(req as any, res as any, async () => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          timestamp: new Date().toISOString(),
          relayPush: {
            connectedMachines: relayHub.connectedMachineCount(),
            queuedNotifications: relayHub.queuedNotificationCount(),
          },
        }),
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/relay-push/enqueue') {
      const authHeader = req.headers.authorization || '';
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const pushToken = (req.headers['x-relay-push-token'] as string | undefined)?.trim() || bearerToken;

      if (RELAY_PUSH_TOKEN && pushToken !== RELAY_PUSH_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized relay push request' }));
        return;
      }

      try {
        const response = await relayHub.handleEnqueueRequest(req);
        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response.body));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown relay push error';
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    trpcHandler(req, res);
  });
});

server.on('upgrade', async (request, socket, head) => {
  try {
    await relayHub.handleUpgrade(request, socket, head);
  } catch (error) {
    console.error('[RelayHub] upgrade failed:', error);
    socket.destroy();
  }
});

server.listen(PORT);

console.log(`✓ tRPC server listening on http://localhost:${PORT}`);
console.log(`✓ Relay push hub listening on ws://localhost:${PORT}/relay-push/companion`);
