import type { IncomingMessage } from 'http';
import type { RawData } from 'ws';
import { WebSocket, WebSocketServer } from 'ws';
import { db } from '@ekybot/db';
import {
  CompanionProtocolVersion,
  CompanionRelaySocketAckSchema,
  CompanionRelaySocketConnectedSchema,
  CompanionRelaySocketWakeSchema,
} from '@ekybot/shared';

type RelayWakeEvent = {
  protocolVersion: typeof CompanionProtocolVersion;
  type: 'relay.wake';
  machineId: string;
  notificationId: string;
  requestId?: string;
  createdAt: string;
};

function sendJson(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

export class RelayPushHub {
  private socketsByMachineId = new Map<string, Set<WebSocket>>();
  private queueByMachineId = new Map<string, RelayWakeEvent[]>();
  private wsServer = new WebSocketServer({ noServer: true });

  constructor() {
    this.wsServer.on('connection', (socket: WebSocket, _request: IncomingMessage, machineId: string) => {
      this.registerSocket(machineId, socket);

      sendJson(
        socket,
        CompanionRelaySocketConnectedSchema.parse({
          protocolVersion: CompanionProtocolVersion,
          type: 'companion.connected',
          machineId,
          connectedAt: new Date().toISOString(),
        }),
      );
      this.flush(machineId);

      socket.on('message', (raw: RawData) => {
        try {
          const message = CompanionRelaySocketAckSchema.parse(JSON.parse(String(raw)));
          if (message.type === 'relay.ack') {
            console.log(
              `[RelayHub] ack machine=${message.machineId} notification=${message.notificationId || 'n/a'} request=${message.requestId || 'n/a'}`,
            );
          }
        } catch {
          console.warn('[RelayHub] ignoring malformed client message');
        }
      });

      socket.on('close', () => {
        this.unregisterSocket(machineId, socket);
      });
    });
  }

  async handleEnqueueRequest(req: IncomingMessage) {
    const body = await parseJsonBody(req);
    const notificationId =
      body && typeof body === 'object' && typeof (body as Record<string, unknown>).notificationId === 'string'
        ? ((body as Record<string, unknown>).notificationId as string)
        : null;

    if (!notificationId) {
      return { status: 400, body: { error: 'notificationId is required' } };
    }

    const wakeEvents = await this.buildWakeEvents(notificationId);
    for (const event of wakeEvents) {
      this.enqueue(event);
    }

    return {
      status: 200,
      body: {
        notificationId,
        queued: wakeEvents.length,
        machineIds: wakeEvents.map((event) => event.machineId),
      },
    };
  }

  async handleUpgrade(request: IncomingMessage, socket: any, head: Buffer) {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname !== '/relay-push/companion') {
      socket.destroy();
      return;
    }

    const machineId = url.searchParams.get('machineId');
    const apiKey = request.headers['x-companion-api-key'];
    const token = Array.isArray(apiKey) ? apiKey[0] : apiKey;

    if (!machineId || !token) {
      socket.destroy();
      return;
    }

    const machine = await db.companionMachine.findFirst({
      where: {
        id: machineId,
        apiKey: token,
      },
      select: { id: true },
    });

    if (!machine) {
      socket.destroy();
      return;
    }

    this.wsServer.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      this.wsServer.emit('connection', ws, request, machine.id);
    });
  }

  connectedMachineCount() {
    return this.socketsByMachineId.size;
  }

  queuedNotificationCount() {
    return [...this.queueByMachineId.values()].reduce((sum, events) => sum + events.length, 0);
  }

  private registerSocket(machineId: string, socket: WebSocket) {
    const sockets = this.socketsByMachineId.get(machineId) || new Set<WebSocket>();
    sockets.add(socket);
    this.socketsByMachineId.set(machineId, sockets);
    console.log(`[RelayHub] connected machine=${machineId} sockets=${sockets.size}`);
  }

  private unregisterSocket(machineId: string, socket: WebSocket) {
    const sockets = this.socketsByMachineId.get(machineId);
    if (!sockets) {
      return;
    }

    sockets.delete(socket);
    if (sockets.size === 0) {
      this.socketsByMachineId.delete(machineId);
    }
    console.log(`[RelayHub] disconnected machine=${machineId} sockets=${sockets.size}`);
  }

  private enqueue(event: RelayWakeEvent) {
    const queue = this.queueByMachineId.get(event.machineId) || [];
    const duplicate = queue.some((entry) => entry.notificationId === event.notificationId);
    if (!duplicate) {
      queue.push(event);
      this.queueByMachineId.set(event.machineId, queue);
    }
    this.flush(event.machineId);
  }

  private flush(machineId: string) {
    const sockets = this.socketsByMachineId.get(machineId);
    const queue = this.queueByMachineId.get(machineId);
    if (!sockets || sockets.size === 0 || !queue || queue.length === 0) {
      return;
    }

    const pending = [...queue];
    this.queueByMachineId.set(machineId, []);

    for (const event of pending) {
      const payload = CompanionRelaySocketWakeSchema.parse(event);
      for (const socket of sockets) {
        sendJson(socket, payload);
      }
      console.log(
        `[RelayHub] wake machine=${machineId} notification=${event.notificationId} request=${event.requestId || 'n/a'}`,
      );
    }
  }

  private async buildWakeEvents(notificationId: string): Promise<RelayWakeEvent[]> {
    const notification = await db.agentNotification.findUnique({
      where: { id: notificationId },
      include: {
        interAgentTurn: {
          select: {
            requestId: true,
          },
        },
      },
    });

    if (!notification) {
      return [];
    }

    const managedAgents = await db.companionManagedAgent.findMany({
      where: {
        openclawAgentId: notification.toAgentId,
        machine: {
          status: {
            in: ['online', 'degraded'],
          },
        },
      },
      select: {
        machineId: true,
      },
    });

    return managedAgents.map((agent: { machineId: string }) => ({
      protocolVersion: CompanionProtocolVersion,
      type: 'relay.wake' as const,
      machineId: agent.machineId,
      notificationId: notification.id,
      requestId: notification.interAgentTurn?.requestId || undefined,
      createdAt: new Date().toISOString(),
    }));
  }
}
