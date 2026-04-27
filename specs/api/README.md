# API contracts

Formal, machine-readable contracts for every HTTP endpoint and WebSocket channel the gameshow backend exposes. Any of the three PWAs (show/admin/gamemaster) can be replaced by a drop-in alternative that implements the same contract — these documents are the authoritative description of what that contract is.

## Files

| File | What it describes |
|------|-------------------|
| [`inventory.md`](inventory.md) | Human-readable catalog of every route + channel, grouped by zone. Source of truth for the YAMLs. |
| [`openapi.yaml`](openapi.yaml) | OpenAPI 3.1 for all HTTP routes. Lintable, renderable in Swagger UI or Redocly, generates client SDKs. |
| [`asyncapi.yaml`](asyncapi.yaml) | AsyncAPI 3.1 for the single `/api/ws` endpoint and its 16 channels. |
| [`redocly.yaml`](redocly.yaml) | Redocly lint config — suppresses false-positive "unused component" warnings for SSE/WS payloads that can't be `$ref`'d inline. |

Per-zone drop-in replacement guides live under [`../../docs/`](../../docs/):

- [`docs/replace-frontend.md`](../../docs/replace-frontend.md) — replacing the show PWA
- [`docs/replace-admin.md`](../../docs/replace-admin.md) — replacing the admin CMS PWA
- [`docs/replace-gamemaster.md`](../../docs/replace-gamemaster.md) — replacing the gamemaster PWA

## How to validate

```bash
# OpenAPI
npx @redocly/cli lint --config specs/api/redocly.yaml specs/api/openapi.yaml

# AsyncAPI
npx @asyncapi/cli validate specs/api/asyncapi.yaml
```

Contract tests live under `tests/contracts/` and run as part of `npm test`.

## The contract-first rule

**Every change to an HTTP route or WebSocket channel MUST update these docs in the same commit.** See [`AGENTS.md`](../../AGENTS.md) §"API contracts" for the full discipline. If the docs don't match the code, the task is not done.
