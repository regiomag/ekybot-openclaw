# Agent Model Source Of Truth Mini-Spec

## Scope
- This spec is for the follow-up model-sync work only.
- No implementation is included in the current communication-stability patch.

## Problem
- Agent model state currently diverges across three stores:
  - DB `Agent.model`
  - OpenClaw managed fragment `~/.openclaw/managed/ekybot.agents.json5`
  - OpenClaw session cache `~/.openclaw/agents/main/sessions/sessions.json`
- When one store is updated without the others, gateway behavior becomes nondeterministic.

## Goal
- Define one user-facing entry point to change an agent model.
- Guarantee that DB, managed fragment, and session cache converge after one successful change.
- Preserve Companion-managed runtime behavior.

## Single Entry Point
- Proposed endpoint: `POST /api/agents/:id/model`
- Input:
  - `agentId`
  - `model`
  - optional `reason`
- Auth:
  - authenticated Ekybot user only
  - user must own the target agent

## Write Contract
1. Validate the requested model string.
2. Update DB `Agent.model`.
3. Patch the managed fragment entry for the matching `openclawAgentId`.
4. Invalidate or reconcile any cached session model for that same agent.
5. Return a payload with:
  - `agentId`
  - `openclawAgentId`
  - `previousModel`
  - `nextModel`
  - `syncStatus`
  - `requestId`

## Runtime Rules
- DB remains the product source of truth.
- Managed fragment is the runtime projection of the DB value.
- Session cache must never outlive a newer managed-fragment model.
- If cache reconciliation fails, the API call must surface a partial-failure status instead of silently succeeding.

## Companion Constraints
- Companion must continue writing managed agents to `ekybot.agents.json5`.
- `openclaw.json` must not become a second writable agent list.
- Any future validation should warn if both `openclaw.json` and the managed fragment define the same agent id.

## Validation Plan
- Change Odin model and confirm:
  - DB updated
  - managed fragment updated
  - next gateway run uses the new model
- Change one Ollama agent model and confirm the same flow.
- Restart OpenClaw and confirm the new model persists without manual cache surgery.

## Non-Goals For This Pass
- No automatic migration of historical bad model values.
- No global settings UI redesign.
- No gateway refactor outside model reconciliation.
