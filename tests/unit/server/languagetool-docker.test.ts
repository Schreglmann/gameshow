import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getStatus,
  start,
  stop,
  cancel,
  _setDockerRunner,
  _setPullRunner,
  _resetDockerState,
  type DockerRunner,
} from '../../../server/languagetool-docker.js';
import { _resetSpellcheckState } from '../../../server/spellcheck.js';

afterEach(() => {
  vi.unstubAllGlobals();
  _setDockerRunner(null);
  _setPullRunner(null);
  _resetDockerState();
  _resetSpellcheckState();
});


const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
const fail = (code = 1, stderr = 'boom') => ({ code, stdout: '', stderr });

/** Stub the health endpoint (GET /v2/languages) to return ok/!ok. */
function stubHealth(reachable: boolean) {
  vi.stubGlobal('fetch', async () => ({ ok: reachable, status: reachable ? 200 : 503, json: async () => ({}) }) as unknown as Response);
}

/**
 * Build a docker runner from a per-subcommand handler map. The first arg selects the handler
 * (version/images/inspect/pull/run/start/stop).
 */
function runner(handlers: Partial<Record<string, () => { code: number; stdout: string; stderr: string }>>): DockerRunner {
  return async (args) => {
    const h = handlers[args[0]];
    return h ? h() : ok();
  };
}

describe('languagetool-docker — getStatus', () => {
  it('reports docker unavailable when the CLI is missing (ENOENT)', async () => {
    _setDockerRunner(async () => ({ code: -1, stdout: '', stderr: '', spawnError: 'enoent' }));
    const s = await getStatus();
    expect(s.dockerAvailable).toBe(false);
    expect(s.active).toBe(false);
    expect(s.container).toBe('absent');
  });

  it('reports running + healthy and marks the checker active', async () => {
    stubHealth(true);
    _setDockerRunner(runner({
      version: () => ok('27.0'),
      images: () => ok('sha256:abc'),
      inspect: () => ok('running'),
    }));
    const s = await getStatus();
    expect(s.dockerAvailable).toBe(true);
    expect(s.imagePresent).toBe(true);
    expect(s.container).toBe('running');
    expect(s.healthy).toBe(true);
    expect(s.active).toBe(true);
    expect(s.ready).toBe(true); // warm-up is a no-op in tests → ready immediately
    expect(s.phase).toBe('running');
  });

  it('reports stopped container as not active / not ready', async () => {
    stubHealth(true);
    _setDockerRunner(runner({
      version: () => ok('27.0'),
      images: () => ok('sha256:abc'),
      inspect: () => ok('exited'),
    }));
    const s = await getStatus();
    expect(s.container).toBe('stopped');
    expect(s.active).toBe(false);
    expect(s.ready).toBe(false);
  });
});

describe('languagetool-docker — start', () => {
  it('pulls when the image is missing, runs the container, waits for health, then routes', async () => {
    stubHealth(true);
    const calls: string[] = [];
    let pulled = false;
    let running = false;
    _setDockerRunner(async (args) => {
      calls.push(args[0]);
      switch (args[0]) {
        case 'version': return ok('27.0');
        case 'images': return ok(pulled ? 'sha256:abc' : '');
        case 'inspect': return running ? ok('running') : fail(1, 'No such object');
        case 'run': running = true; return ok('containerid');
        default: return ok();
      }
    });
    _setPullRunner(async (_img, onLine) => {
      pulled = true;
      onLine('abc123def456: Pulling fs layer');
      onLine('abc123def456: Pull complete');
      return ok();
    });
    await start({ pollIntervalMs: 1, healthTimeoutMs: 100, warmUp: false });
    expect(calls).toContain('run'); // pull goes through the pull runner, not dockerRunner
    const s = await getStatus();
    expect(s.phase).toBe('running');
    expect(s.active).toBe(true);
  });

  it('reports image-pull progress (completed/total layers) while pulling', async () => {
    let resolvePull: (() => void) | null = null;
    let onLineRef: ((l: string) => void) | null = null;
    _setDockerRunner(async (args) => {
      switch (args[0]) {
        case 'version': return ok('27.0');
        case 'images': return ok(''); // missing → pull
        default: return ok();
      }
    });
    _setPullRunner((_img, onLine) => new Promise(res => {
      onLineRef = onLine;
      resolvePull = () => res(ok());
    }));
    // start() will block in the pull; drive progress, then let it fail health quickly to settle.
    stubHealth(false);
    const p = start({ pollIntervalMs: 1, healthTimeoutMs: 5 });
    await vi.waitFor(() => expect(onLineRef).not.toBeNull());
    onLineRef!('a1b2c3d4e5f6: Pulling fs layer');
    onLineRef!('f6e5d4c3b2a1: Pulling fs layer');
    onLineRef!('a1b2c3d4e5f6: Pull complete');
    expect((await getStatus()).progress).toBe(50); // 1 of 2 layers complete
    onLineRef!('f6e5d4c3b2a1: Pull complete');
    expect((await getStatus()).progress).toBe(100);
    resolvePull!();
    await p;
  });

  it('uses `docker start` when the container exists but is stopped', async () => {
    stubHealth(true);
    const calls: string[] = [];
    let running = false;
    _setDockerRunner(async (args) => {
      calls.push(args[0]);
      switch (args[0]) {
        case 'version': return ok('27.0');
        case 'images': return ok('sha256:abc'); // image present → no pull
        case 'inspect': return running ? ok('running') : ok('exited');
        case 'start': running = true; return ok();
        default: return ok();
      }
    });
    await start({ pollIntervalMs: 1, healthTimeoutMs: 100, warmUp: false });
    expect(calls).toContain('start');
    expect(calls).not.toContain('pull');
    expect(calls).not.toContain('run');
    expect((await getStatus()).phase).toBe('running');
  });

  it('errors (does not hang forever) when the container never becomes healthy', async () => {
    stubHealth(false); // never healthy
    _setDockerRunner(runner({
      version: () => ok('27.0'),
      images: () => ok('sha256:abc'),
      inspect: () => ok('running'),
      start: () => ok(),
    }));
    await start({ pollIntervalMs: 1, healthTimeoutMs: 20 });
    // getStatus would re-derive from the (unhealthy) container; assert the phase landed on error
    // before any reconciliation by checking the message path via a fresh status read.
    const s = await getStatus();
    expect(s.healthy).toBe(false);
    expect(s.active).toBe(false);
  });

  it('errors when docker is unavailable', async () => {
    _setDockerRunner(async () => ({ code: -1, stdout: '', stderr: '', spawnError: 'enoent' }));
    await start({ pollIntervalMs: 1, healthTimeoutMs: 20 });
    const s = await getStatus();
    expect(s.dockerAvailable).toBe(false);
    expect(s.active).toBe(false);
  });

  it('cancel during pull aborts the pull and returns to idle', async () => {
    stubHealth(false);
    _setDockerRunner(runner({ version: () => ok('27.0'), images: () => ok('') })); // image missing → pull
    // A pull runner that only resolves when aborted (simulates a long-running pull).
    _setPullRunner((_img, _onLine, _t, signal) => new Promise(res => {
      signal?.addEventListener('abort', () => res({ code: -1, stdout: '', stderr: '', cancelled: true }));
    }));
    const p = start({ pollIntervalMs: 1, healthTimeoutMs: 50, warmUp: false });
    await vi.waitFor(async () => { expect((await getStatus()).phase).toBe('pulling'); });
    await cancel();
    await p;
    expect((await getStatus()).phase).toBe('idle');
  });
});

describe('languagetool-docker — stop', () => {
  it('stops the container and deactivates routing', async () => {
    stubHealth(true);
    const calls: string[] = [];
    _setDockerRunner(async (args) => {
      calls.push(args[0]);
      if (args[0] === 'version') return ok('27.0');
      if (args[0] === 'inspect') return ok('exited');
      if (args[0] === 'images') return ok('sha256:abc');
      return ok();
    });
    await stop();
    expect(calls).toContain('stop');
    const s = await getStatus();
    expect(s.active).toBe(false);
  });
});
