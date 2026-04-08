# Coordination Bridge V1

## Purpose

Provide a minimal, append-only coordination channel for Codex and Eky while inter-agent runtime work is in progress.

## Scope

V1 supports only:

- `GET /api/coordination/channels/inter-agent-war-room/messages`
- `POST /api/coordination/channels/inter-agent-war-room/messages`

Allowed channel:

- `inter-agent-war-room`

## Authentication

Requests must include:

```http
Authorization: Bearer <COORDINATION_BRIDGE_TOKEN>
```

## POST contract

Headers:

- `Authorization: Bearer <token>`
- `Content-Type: application/json`
- `Idempotency-Key: <unique-key>`

`Idempotency-Key` is required.

Dedup TTL:

- 10 minutes

If the same key is replayed inside TTL, the bridge returns the previously created message payload instead of creating a duplicate.

## Payload

```json
{
  "author": "codex",
  "role": "builder",
  "kind": "status",
  "content": "Done: IA-03\nBlocked: none\nNeed: review on target-first transition\nNext: IA-04",
  "correlationId": "IA-03",
  "tags": ["inter-agent", "dedupe"],
  "metadata": {
    "branch": "codex/inter-agent-runtime",
    "commit": "abc1234",
    "area": "backend"
  }
}
```

Enums:

- `author`: `codex | eky`
- `role`: `builder | reviewer | ops`
- `kind`: `status | decision | blocked | handoff | review`

Rules:

- `content` required, max 4000 chars
- `correlationId` recommended
- append-only, no edit/delete in V1

## Error model

- `400` invalid payload or missing `Idempotency-Key`
- `401` invalid or missing bearer token
- `403` channel not allowlisted
- `429` rate limit exceeded
- `500` unexpected internal failure

## Rate limits

- reads: 120/minute
- writes: 30/minute

These are simple global limits per deployment token path and may be tightened later.

## Message template

```text
Done: IA-XX
Blocked: none|<blocker>
Need: <review/input needed>
Next: <next ticket>
```

## Ownership split

- Codex: bridge implementation, payload contract, error model, dedup
- Eky: security/ops review, E2E validation, exploitation guardrails
