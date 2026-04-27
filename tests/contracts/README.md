# Contract tests

These tests validate that the running server's HTTP and WebSocket responses match the contracts in [`specs/api/openapi.yaml`](../../specs/api/openapi.yaml) and [`specs/api/asyncapi.yaml`](../../specs/api/asyncapi.yaml).

Keeping the contract docs honest is the only protection against docs drifting from code as the server evolves — every endpoint here is exercised against a real response and validated with ajv.

## How to run

1. Start the dev server in one terminal:
   ```bash
   npm run dev
   ```
2. Run the contract tests in another:
   ```bash
   npm run test:contracts
   ```

The tests auto-skip if `http://localhost:3000/api/settings` isn't reachable, so CI jobs that don't spin up the server just pass a "skipped: no server" message rather than failing.

## Layout

- `openapi-contract.test.ts` — validates representative responses from every HTTP operation.
- `asyncapi-contract.test.ts` — connects to `/api/ws` and validates initial-state messages.
- `schema-loader.ts` — loads OpenAPI/AsyncAPI YAML and wires ajv.
- `fixtures/` — deterministic request bodies when an endpoint needs a payload.

## Adding new endpoints

When you add a route or channel:

1. Update [`specs/api/openapi.yaml`](../../specs/api/openapi.yaml) or [`specs/api/asyncapi.yaml`](../../specs/api/asyncapi.yaml).
2. Add a test case here covering at least the happy-path response.
3. Run `npm run test:contracts` — the new case should pass. If ajv complains, fix the spec, not the test.
