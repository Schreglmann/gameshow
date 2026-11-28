#!/usr/bin/env node
'use strict';
/**
 * Production supervisor for the gameshow server (`npm start`).
 *
 * Starts `node dist/server/server/index.js` and restarts it whenever it exits,
 * unless the supervisor itself was asked to stop (SIGINT / SIGTERM / SIGHUP).
 *
 *   - Restart delay: immediate, then 1 s, 2 s, 4 s, 8 s, capped at 10 s. Resets
 *     after 60 s of uptime. Never gives up — this runs during a live show.
 *   - Server stdout/stderr go to the console and to logs/server-YYYY-MM-DD.log.
 *   - Every unplanned exit is appended to logs/crash.log. logs/last-crash.json
 *     (shown in the admin System tab) is written here unless the server already
 *     wrote it with the real error message (uncaughtException, server/crash-log.ts).
 *   - Hang watchdog: once GET /api/health has answered, it is polled every 5 s.
 *     No answer for 30 s → SIGKILL and restart. Disable with SUPERVISE_WATCHDOG=0.
 *     A process stuck in a NAS kernel call only dies once that call returns.
 *
 * See specs/crash-recovery.md. `npm run start:unsupervised` runs the server directly.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LOGS_DIR = path.join(ROOT, 'logs');
const SERVER_ENTRY = path.join(ROOT, 'dist', 'server', 'server', 'index.js');
const PORT = process.env.PORT || 3000;

const MAX_RESTART_DELAY_MS = 10_000;
const HEALTHY_RESET_MS = 60_000;
const WATCHDOG_INTERVAL_MS = 5_000;
const WATCHDOG_TIMEOUT_MS = 30_000;
const HEALTH_REQUEST_TIMEOUT_MS = 4_000;
const STOP_FORCE_KILL_MS = 10_000;
const STDERR_TAIL_LINES = 80;

/* ------------------------------------------------------------- pure logic */

/**
 * Delay before restart number `crashCount` (1-based, counted since the last
 * healthy run): 0, 1000, 2000, 4000, 8000, then 10000.
 */
function restartDelay(crashCount) {
  if (crashCount <= 1) return 0;
  return Math.min(1000 * 2 ** (crashCount - 2), MAX_RESTART_DELAY_MS);
}

/** Crash counter after a run of `uptimeMs`: a healthy run resets the backoff. */
function nextCrashCount(prevCount, uptimeMs) {
  return uptimeMs >= HEALTHY_RESET_MS ? 1 : prevCount + 1;
}

/** Keeps the last `maxLines` lines of a text stream that arrives in chunks. */
class TailBuffer {
  constructor(maxLines) {
    this.maxLines = maxLines;
    this.lines = [];
    this.partial = '';
  }
  push(chunk) {
    const parts = (this.partial + String(chunk)).split('\n');
    this.partial = parts.pop() ?? '';
    for (const line of parts) this.lines.push(line);
    if (this.lines.length > this.maxLines) this.lines.splice(0, this.lines.length - this.maxLines);
  }
  text() {
    const all = this.partial ? [...this.lines, this.partial] : this.lines;
    return all.slice(-this.maxLines).join('\n');
  }
  clear() {
    this.lines = [];
    this.partial = '';
  }
}

/** Local calendar day, `YYYY-MM-DD`. */
function dayStamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Short German reason for the admin "Letzter Absturz" line. */
function describeExit(code, signal, watchdogKilled) {
  if (watchdogKilled) return 'Keine Antwort mehr (Watchdog-Neustart)';
  if (signal) return `Beendet durch ${signal}`;
  return `Exit-Code ${code}`;
}

/* ------------------------------------------------------------ supervisor */

function log(msg) {
  console.log(`[supervise] ${msg}`);
}

function ensureLogsDir() {
  try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch { /* best-effort */ }
}

let logStream = null;
let logStreamDay = '';
function writeServerLog(chunk) {
  const day = dayStamp(new Date());
  if (day !== logStreamDay) {
    if (logStream) logStream.end();
    ensureLogsDir();
    logStream = fs.createWriteStream(path.join(LOGS_DIR, `server-${day}.log`), { flags: 'a' });
    logStream.on('error', () => { /* a full disk must not stop the supervisor */ });
    logStreamDay = day;
  }
  logStream.write(chunk);
}

function appendCrashLog(text) {
  try {
    ensureLogsDir();
    fs.appendFileSync(path.join(LOGS_DIR, 'crash.log'), text);
  } catch { /* best-effort */ }
}

/** True when the server wrote last-crash.json itself during this run. */
function serverWroteLastCrash(sinceMs) {
  try {
    return fs.statSync(path.join(LOGS_DIR, 'last-crash.json')).mtimeMs >= sinceMs;
  } catch {
    return false;
  }
}

function writeLastCrash(reason) {
  try {
    ensureLogsDir();
    fs.writeFileSync(
      path.join(LOGS_DIR, 'last-crash.json'),
      JSON.stringify({ at: new Date().toISOString(), reason }, null, 2) + '\n',
    );
  } catch { /* best-effort */ }
}

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/health', timeout: HEALTH_REQUEST_TIMEOUT_MS }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function main() {
  if (!fs.existsSync(SERVER_ENTRY)) {
    console.error(`[supervise] ${path.relative(ROOT, SERVER_ENTRY)} not found — run \`npm run build\` first.`);
    process.exit(1);
  }

  const watchdogEnabled = process.env.SUPERVISE_WATCHDOG !== '0';
  const stderrTail = new TailBuffer(STDERR_TAIL_LINES);
  let child = null;
  let childStartedAt = 0;
  let crashCount = 0;
  let stopping = false;
  let watchdogKilled = false;
  let watchdogTimer = null;
  let restartTimer = null;

  function stopWatchdog() {
    if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
  }

  function startWatchdog(proc) {
    let lastOkAt = null;
    const tick = async () => {
      watchdogTimer = null;
      if (child !== proc || stopping) return;
      const ok = await checkHealth();
      if (child !== proc || stopping) return;
      const now = Date.now();
      if (ok) {
        if (lastOkAt === null) log(`server is answering on port ${PORT}`);
        lastOkAt = now;
      } else if (lastOkAt !== null && now - lastOkAt >= WATCHDOG_TIMEOUT_MS) {
        log(`server unresponsive for ${Math.round((now - lastOkAt) / 1000)} s — killing pid ${proc.pid}`);
        watchdogKilled = true;
        try { proc.kill('SIGKILL'); } catch { /* already gone */ }
        return;
      }
      watchdogTimer = setTimeout(tick, WATCHDOG_INTERVAL_MS);
    };
    watchdogTimer = setTimeout(tick, WATCHDOG_INTERVAL_MS);
  }

  function start() {
    restartTimer = null;
    stderrTail.clear();
    watchdogKilled = false;
    childStartedAt = Date.now();
    const proc = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: ROOT,
      env: { ...process.env, UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || '32', GAMESHOW_SUPERVISED: '1' },
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    child = proc;
    log(`started server (pid ${proc.pid})`);

    proc.stdout.on('data', (chunk) => { process.stdout.write(chunk); writeServerLog(chunk); });
    proc.stderr.on('data', (chunk) => { process.stderr.write(chunk); writeServerLog(chunk); stderrTail.push(chunk); });
    proc.on('error', (err) => log(`could not start server: ${err.message}`));
    proc.on('exit', (code, signal) => onExit(proc, code, signal));

    if (watchdogEnabled) startWatchdog(proc);
  }

  function onExit(proc, code, signal) {
    if (child !== proc) return;
    child = null;
    stopWatchdog();
    if (stopping) {
      log('server stopped');
      process.exit(typeof code === 'number' ? code : 0);
    }

    const uptimeMs = Date.now() - childStartedAt;
    crashCount = nextCrashCount(crashCount, uptimeMs);
    const delay = restartDelay(crashCount);
    const reason = describeExit(code, signal, watchdogKilled);
    const serverLogged = serverWroteLastCrash(childStartedAt);
    if (!serverLogged) writeLastCrash(reason);

    const header = `[${new Date().toISOString()}] Server beendet: ${reason} nach ${Math.round(uptimeMs / 1000)} s Laufzeit — Neustart in ${delay} ms\n`;
    // When the server logged its own uncaughtException, the stack is already in
    // crash.log; otherwise the stderr tail is the only trace of what happened.
    const tail = serverLogged ? '' : `--- letzte stderr-Zeilen ---\n${stderrTail.text()}\n`;
    appendCrashLog(`${header}${tail}\n`);
    log(`server exited (${reason}) — restarting in ${delay} ms`);
    restartTimer = setTimeout(start, delay);
  }

  function stop(signal) {
    if (stopping) return;
    stopping = true;
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    stopWatchdog();
    if (!child) process.exit(0);
    log(`${signal} received — stopping server`);
    try { child.kill(signal); } catch { /* already gone */ }
    setTimeout(() => {
      if (child) {
        log('server did not stop in time — killing it');
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
    }, STOP_FORCE_KILL_MS).unref();
  }

  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGHUP', () => stop('SIGTERM'));

  start();
}

if (require.main === module) {
  main();
} else {
  module.exports = { restartDelay, nextCrashCount, TailBuffer, dayStamp, describeExit };
}
