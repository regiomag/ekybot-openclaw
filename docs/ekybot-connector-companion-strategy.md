# EkyBot Connector / Companion Strategy

## Recommendation

Do not embed the full Companion runtime inside the current web monorepo.

Instead:

- keep the cloud contracts and protocol definitions in this monorepo
- evolve `ekybot-connector` into the local Companion runtime repo
- let the Companion consume the shared protocol version from EkyBot

## Why

The Companion has a different lifecycle than the web app:

- local daemon/runtime concerns
- OS integration
- launch agent / service management
- OpenClaw file system access
- health checks and local logs

Keeping that runtime as a separate repo is cleaner operationally.

## What lives where

### This repo (`ekybot`)

- product UI
- cloud APIs
- desired state model
- machine inventory model
- config operation model
- onboarding/import UI
- shared protocol and schema definitions

### `ekybot-connector` repo

- local daemon / companion runtime
- OpenClaw inventory scanner
- fragment writer
- reconciler
- plotter/poller integration
- launchd/systemd packaging
- local support bundle generation

## Safe Migration Path

Because current production users must remain functional:

- no migration of existing OpenClaw config is performed yet
- no runtime path in the current app is replaced yet
- the first implementation step is protocol and architecture preparation only

When ready, the Companion can be introduced behind feature flags:

- `companion_inventory`
- `companion_import`
- `companion_managed_agents`
- `companion_config_apply`

