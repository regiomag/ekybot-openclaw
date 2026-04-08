# OpenClaw Companion Implementation Plan

## Goal

Make EkyBot the primary onboarding and agent management UI while minimizing dependence on OpenClaw internals and preserving existing user installations.

The target operating model is:

- EkyBot cloud stores desired state, not full OpenClaw config.
- A local EkyBot Companion is the only actor allowed to materialize config changes on the OpenClaw machine.
- OpenClaw remains authoritative for runtime execution.
- Existing local setups can be imported progressively without breaking manual workflows.

## Why Change

The current implementation mixes three weakly-coupled patterns:

- prompt-driven provisioning via the orchestrator agent
- direct calls to custom gateway/admin endpoints
- local scripts such as the plotter/poller for message delivery

This works for demos and advanced users, but it has structural limitations:

- agent creation depends on model behavior and prompt success
- config automation relies on non-standard/private surfaces
- user installs are hard to reason about when local config already exists
- support is expensive because the source of truth is unclear

## OpenClaw Assumptions

This plan assumes the officially documented OpenClaw surfaces remain available:

- config file at `~/.openclaw/openclaw.json`
- support for `$include` fragments
- CLI configuration commands such as `openclaw config set`, `openclaw agents add`, `openclaw agents bind`
- programmatic config patch/apply flow
- hot-apply for at least `agents`, `models`, `routing`, and `bindings` in hybrid mode

The Companion should prefer official CLI/RPC/config patching over any private endpoint.

## Target Architecture

### 1. Desired State in EkyBot Cloud

EkyBot stores a minimal desired state per machine/workspace, for example:

- machine registration
- gateway identity
- managed agents
- managed bindings
- managed model selection per agent
- workspace metadata and templates
- config generation version
- last applied hash

EkyBot must not store or generate the full OpenClaw root config.

### 2. Local EkyBot Companion

The Companion runs on the same machine as OpenClaw and is responsible for:

- registration with EkyBot
- local inventory of OpenClaw state
- import of existing agents/config
- writing only EkyBot-managed config fragments
- applying changes through official OpenClaw interfaces
- local health checks and structured logs
- plotter/polling responsibilities if still needed

The Companion becomes the single local control plane.

### 3. Managed Fragment Strategy

OpenClaw root config remains user-owned.

EkyBot writes only managed fragments, for example:

- `~/.openclaw/managed/ekybot.agents.json5`
- `~/.openclaw/managed/ekybot.bindings.json5`
- optionally `~/.openclaw/managed/ekybot.models.json5`

The root `openclaw.json` contains an `$include` to these fragments.

This gives:

- low blast radius
- easier rollback
- clearer ownership boundaries
- safer coexistence with manual OpenClaw setups

### 4. Reconciler

The Companion continuously compares:

- desired state from EkyBot
- actual local OpenClaw state
- last applied EkyBot snapshot/hash

It then produces a plan of operations:

- create
- update
- bind/unbind
- import
- ignore
- conflict
- manual action required

The reconciler applies only safe operations automatically.

## Ownership Model

Every local agent must have one explicit ownership state:

- `managed`
- `external`
- `adoptable`
- `conflicted`

### managed

The agent is controlled by EkyBot. EkyBot may update:

- model
- bindings
- generated workspace files owned by EkyBot
- metadata mirrored to UI

### external

The agent exists locally but is not controlled by EkyBot.

EkyBot may display it, but must not mutate it automatically.

### adoptable

The agent exists locally and can be imported into EkyBot after explicit user confirmation.

### conflicted

The system cannot safely determine whether the local and cloud records represent the same agent.

Human confirmation is required before write operations.

## Handling Existing Users and Existing Config

This is the most important migration path.

### Phase A. Discovery

On first Companion connect, perform local discovery:

- read `openclaw.json`
- resolve includes
- list agents, bindings, models, workspace paths
- inspect workspace folders
- detect plotter/poller presence
- compute fingerprints for local agents

Suggested local fingerprint fields:

- `agentId`
- `name`
- `workspace`
- `model`
- `binding targets`
- `workspace file hashes`

### Phase B. Cloud Inventory Upload

The Companion uploads a machine inventory to EkyBot:

- local agents discovered
- ownership classification guess
- missing/invalid references
- local warnings
- config hash

### Phase C. Import Wizard

In EkyBot, the user sees an import wizard:

- local-only agents
- cloud-only agents
- probable matches
- conflicts

Per agent, the user chooses:

- import into EkyBot
- keep local only
- merge with an existing EkyBot agent
- postpone

### Phase D. Fragment Bootstrapping

After confirmation:

- Companion creates the managed fragment files
- Companion ensures `$include` is installed in root config
- Companion copies only approved/adopted agents into managed fragment
- manual agents remain outside managed fragment

### Phase E. Ongoing Reconciliation

After migration:

- managed agents are reconciled from EkyBot desired state
- external agents remain visible but read-only by default
- local manual changes on managed agents trigger drift/conflict detection

## Recommended Mapping Rules

To match an existing local OpenClaw agent to an EkyBot agent:

Primary keys:

- `openclawAgentId`
- machine id

Secondary keys:

- normalized workspace path
- normalized name
- recent binding/channel relationship

Never merge solely by display name.

## Cloud Data Model Additions

Suggested new entities and fields:

### Machine

- `id`
- `userId`
- `name`
- `platform`
- `companionVersion`
- `machinePublicKey`
- `status`
- `lastSeenAt`
- `openclawVersion`
- `configMode`
- `lastInventoryHash`

### ManagedAgent

- `id`
- `userId`
- `machineId`
- `openclawAgentId`
- `name`
- `workspacePath`
- `provider`
- `model`
- `ownership`
- `managementScope`
- `desiredConfigVersion`
- `lastAppliedConfigVersion`
- `lastAppliedAt`
- `lastApplyStatus`

### ConfigOperation

- `id`
- `machineId`
- `type`
- `requestedBy`
- `payload`
- `status`
- `createdAt`
- `appliedAt`
- `error`
- `rollbackPayload`

### MachineInventory

- `machineId`
- `snapshot`
- `snapshotHash`
- `createdAt`

## Companion Responsibilities

### Must Do

- authenticate to EkyBot
- fetch desired state
- scan local OpenClaw state
- classify ownership
- write only managed fragment
- apply OpenClaw changes via official interfaces
- emit operation logs and health
- maintain plotter/polling if required

### Must Not Do

- overwrite the full root config from cloud
- mutate external/manual agents silently
- rely on prompt-generated config for correctness
- depend on SSH from cloud into the machine

## Applying Changes Safely

### Agent Creation

Preferred path:

1. create desired agent in EkyBot
2. enqueue operation for machine
3. Companion receives operation
4. Companion creates workspace scaffolding
5. Companion adds/patches managed fragment
6. Companion uses official OpenClaw apply path
7. Companion reports success/failure

If available and stable, prefer:

- `openclaw agents add`
- `openclaw agents bind`
- `config.patch` / `config.apply`

### Model Change

Preferred path:

1. user changes model in EkyBot UI
2. EkyBot updates desired state
3. Companion patches only the managed agent model field
4. OpenClaw hot-applies if supported
5. Companion reports whether restart is required

### Workspace File Generation

EkyBot should generate only EkyBot-owned templates:

- `IDENTITY.md`
- `SOUL.md`
- `USER.md`
- `MEMORY.md`
- `TOOLS.md`
- `AGENTS.md`

Each file should contain a short managed header, e.g.:

- generated by EkyBot
- managed section
- last synced timestamp

For advanced users, allow a split between:

- managed section
- custom section preserved across updates

## Conflict Handling

Conflicts are expected and must be first-class.

### Examples

- local agent model differs from managed desired state
- local workspace path moved manually
- local agent deleted but still managed by cloud
- duplicate names with different `openclawAgentId`

### Policy

Safe auto-resolution:

- additive bindings
- metadata-only updates
- non-destructive workspace file refreshes

Require confirmation:

- model changes after local edits
- workspace path changes
- deletion of existing local agents
- migration of existing manual agents into managed mode

## Onboarding Flow

### New User

1. install OpenClaw
2. install Companion
3. click `Connect my machine`
4. machine registers
5. EkyBot validates gateway and OpenClaw
6. EkyBot creates first agent
7. Companion materializes it locally

### Existing User

1. install Companion
2. machine inventory is uploaded
3. EkyBot shows import wizard
4. user adopts selected agents
5. managed fragment is initialized
6. EkyBot becomes the control plane for adopted agents

## Support, Logs, and Observability

Your caution here is correct: observability is mandatory.

### Companion Logs

Every operation should log:

- machine id
- operation id
- actor
- local config hash before/after
- command or patch applied
- OpenClaw response
- duration
- result

### EkyBot Dashboard

Recommended machine health panel:

- Companion online/offline
- OpenClaw reachable
- plotter healthy
- last config apply status
- last import scan
- drift detected yes/no
- pending actions

### Support Bundle

Allow the Companion to export:

- last 200 operations
- current inventory
- managed fragment
- redacted root config references
- OpenClaw version and mode

## Security Model

### Principles

- cloud sends intentions, not direct shell access
- Companion authenticates with asymmetric credentials if possible
- gateway/admin tokens remain local
- no secret should live in prompt text, repo docs, or browser local storage if avoidable

### Immediate Action

The token exposed in the annex must be rotated.

## Recommended Implementation Order

### Milestone 0. Architecture Guardrails

- define ownership states
- define desired state schema
- define operation journal schema
- define import wizard UX

### Milestone 1. Machine Registration + Inventory

- Companion registration
- local scan of OpenClaw config
- upload inventory
- health heartbeat

Deliverable:

- machine page in EkyBot
- no write operations yet

### Milestone 2. Import Existing Agents

- local/cloud matching rules
- import wizard
- adoption flow
- managed/external classification persisted

Deliverable:

- existing users can connect without disruption

### Milestone 3. Managed Fragment + Apply Engine

- create managed fragment
- install `$include`
- implement reconciler
- apply safe operations through CLI/RPC

Deliverable:

- first reliable config writes without touching root config directly

### Milestone 4. Agent CRUD via Companion

- create agent
- update model
- update bindings
- archive/delete managed agent

Deliverable:

- EkyBot agent page becomes the primary control plane

### Milestone 5. Workspace Template Management

- managed workspace file generation
- preserved custom sections
- diff/preview before apply

### Milestone 6. Replace Prompt-Based Provisioning

- deprecate orchestrator-based config mutation
- keep orchestrator only for reasoning/work, not infra changes

### Milestone 7. Unified Local Service

- fold plotter/poller into Companion
- one install, one service, one health surface

## What to Keep vs Replace

### Keep

- EkyBot cloud as UX/control plane
- gateway credentials stored per user
- OpenClaw as runtime gateway
- plotter concept if reliable delivery still needs it

### Replace

- prompt-driven provisioning for config mutation
- cloud-side assumptions about OpenClaw internal files
- direct dependence on private admin endpoints as primary path

## Development Rules for External Contributors

- All cloud APIs create intentions only.
- Only the Companion applies local admin actions.
- Never rewrite full `openclaw.json` from cloud state.
- Only modify EkyBot-managed fragments.
- Treat unknown local agents as external until adopted.
- Every config write must be diffable and reversible.
- Logs must explain both desired state and actual applied state.

## Risks and Limitations

### Initial Complexity

Yes, this is more complex than the current direct/proxy approach.
Mitigation:

- strict ownership model
- good local installer
- excellent diagnostics
- one Companion binary/service instead of multiple scripts

### Cloud vs Local Drift

This is the central risk.
Mitigation:

- desired state versioning
- inventory snapshots
- explicit conflict states
- last applied hash

### Support Burden

Without logs and health surfaces, support cost will rise.
Mitigation:

- operation journal
- support bundle export
- visible machine health in EkyBot

## Final Recommendation

Build the Companion.

Do not try to make EkyBot cloud directly own OpenClaw internals.
Do not keep prompt-based provisioning as the long-term config path.

The clean strategy is:

- EkyBot owns desired state
- Companion owns reconciliation and local application
- OpenClaw owns runtime execution
- root config stays user-owned
- EkyBot-managed fragments isolate automation safely

