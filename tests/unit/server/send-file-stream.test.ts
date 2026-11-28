import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { sendFileStream } from '../../../server/send-file-stream.js';

// A cache file that vanishes between stat and open must answer 404 instead of
// crashing the server. See specs/crash-recovery.md.
describe('sendFileStream', () => {
  let dir: string;
  let server: http.Server;
  let base: string;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'send-file-'));
    writeFileSync(path.join(dir, 'a.txt'), '0123456789');
    server = http.createServer((req, res) => {
      const name = (req.url ?? '/').slice(1).split('?')[0]!;
      const range = req.url?.includes('range') ? { start: 2, end: 4 } : undefined;
      sendFileStream(res, path.join(dir, name), range);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('streams an existing file', async () => {
    const res = await fetch(`${base}/a.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('0123456789');
  });

  it('streams a byte range', async () => {
    const res = await fetch(`${base}/a.txt?range`);
    expect(await res.text()).toBe('234');
  });

  it('answers 404 for a missing file and the server keeps running', async () => {
    const res = await fetch(`${base}/gone.txt`);
    expect(res.status).toBe(404);
    const again = await fetch(`${base}/a.txt`);
    expect(again.status).toBe(200);
  });
});
