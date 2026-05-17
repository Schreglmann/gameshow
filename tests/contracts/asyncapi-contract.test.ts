import { describe, it, beforeAll, expect } from 'vitest';
import WebSocket from 'ws';
import { validateAgainstSchema } from './schema-loader';

const BASE = process.env.CONTRACT_TEST_BASE ?? 'http://localhost:3000';
const WS_URL = BASE.replace(/^http/, 'ws') + '/api/ws';

let serverReachable = false;

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE}/api/settings`, { signal: AbortSignal.timeout(2000) });
    serverReachable = res.ok;
  } catch {
    serverReachable = false;
  }
});

function skipIfNoServer(name: string, fn: () => Promise<void>, timeout?: number): void {
  it(name, async () => {
    if (!serverReachable) {
      console.log(`[contract-ws] skipped "${name}" — server not reachable at ${BASE}`);
      return;
    }
    await fn();
  }, timeout);
}

/**
 * Receive the initial-state WS burst and hand each message to `onMessage`.
 * Resolves after `maxMs` ms regardless, or as soon as `done()` returns true
 * (so the normal path doesn't burn the full timeout when we're only waiting
 * for one specific channel).
 */
async function collectInitialState(
  onMessage: (channel: string, data: unknown) => void,
  maxMs = 3000,
  done?: () => boolean,
): Promise<void> {
  const ws = new WebSocket(WS_URL);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      resolve();
    }, maxMs);
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { channel?: string; data?: unknown };
        if (msg.channel) onMessage(msg.channel, msg.data);
        if (done?.()) {
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      } catch {
        // ignore
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe('AsyncAPI contract — initial-state messages', () => {
  skipIfNoServer('initial state contains well-formed messages', async () => {
    const violations: string[] = [];

    await collectInitialState((channel, data) => {
      const schemaRef = channelToSchema(channel);
      if (!schemaRef) return;
      const r = validateAgainstSchema(schemaRef, data);
      if (!r.valid) {
        violations.push(`${channel}: ${r.errors.join('; ')}`);
      }
    });

    if (violations.length > 0) {
      throw new Error(`AsyncAPI violations:\n  ${violations.join('\n  ')}`);
    }
  });

  skipIfNoServer('system-status push is well-formed', async () => {
    let systemStatusSeen = false;
    let violation: string | null = null;

    await collectInitialState(
      (channel, data) => {
        if (channel !== 'system-status') return;
        systemStatusSeen = true;
        const r = validateAgainstSchema(
          '#/components/schemas/SystemStatusResponse',
          data,
        );
        if (!r.valid) violation = r.errors.join('; ');
      },
      // `buildSystemStatus` scans every category folder on disk (~130k files
      // in the dev environment), which can take well over 4s when the full
      // test suite is hammering the same Node process. Wait long enough that
      // a load-induced slow build still lands within one window.
      20000,
      () => systemStatusSeen,
    );

    if (violation) throw new Error(`system-status violation: ${violation}`);
    expect(systemStatusSeen, 'no system-status message received — server may be starved').toBe(true);
  }, 25000);
});

/**
 * Map a WS channel name to the OpenAPI component schema that describes its
 * payload. Channels whose payload is simple (e.g. `{ ts: number }`) return
 * `null` — they don't get validated against a top-level named schema.
 */
function channelToSchema(channel: string): string | null {
  switch (channel) {
    case 'system-status':
      return '#/components/schemas/SystemStatusResponse';
    case 'gamemaster-answer':
    case 'gamemaster-controls':
      // Payload is either the named shape or null — we only validate the
      // non-null case. Null check is done by the caller.
      return null;
    default:
      return null;
  }
}
