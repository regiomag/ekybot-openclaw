import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractActiveRequestHeartbeatMap,
  normalizeRelayPatchStatus,
  shouldRequeueStaleRelayNotification,
} from './relay-phase0';

test('extractActiveRequestHeartbeatMap keeps the freshest heartbeat per request', () => {
  const heartbeatMap = extractActiveRequestHeartbeatMap(
    {
      runtimeState: {
        activeRequests: [
          { requestId: 'req-1', lastHeartbeatAt: '2026-03-27T10:00:00.000Z' },
          { requestId: 'req-1', lastHeartbeatAt: '2026-03-27T10:01:00.000Z' },
          { requestId: 'req-2' },
        ],
      },
    },
    '2026-03-27T09:59:30.000Z',
  );

  assert.equal(heartbeatMap.get('req-1'), Date.parse('2026-03-27T10:01:00.000Z'));
  assert.equal(heartbeatMap.get('req-2'), Date.parse('2026-03-27T09:59:30.000Z'));
});

test('shouldRequeueStaleRelayNotification requeues stale notifications without a live heartbeat', () => {
  const now = Date.parse('2026-03-27T10:10:00.000Z');

  assert.equal(
    shouldRequeueStaleRelayNotification({
      notificationUpdatedAt: '2026-03-27T10:03:00.000Z',
      now,
    }),
    true,
  );

  assert.equal(
    shouldRequeueStaleRelayNotification({
      notificationUpdatedAt: '2026-03-27T10:03:00.000Z',
      requestHeartbeatAt: Date.parse('2026-03-27T10:09:00.000Z'),
      now,
    }),
    false,
  );
});

test('normalizeRelayPatchStatus accepts explicit pending requeue requests', () => {
  assert.equal(normalizeRelayPatchStatus('pending'), 'pending');
  assert.equal(normalizeRelayPatchStatus('failed'), 'failed');
  assert.equal(normalizeRelayPatchStatus('unknown'), 'delivered');
});
