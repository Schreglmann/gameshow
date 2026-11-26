/**
 * Process-level crash handling and the crash log under `logs/`.
 *
 * - `uncaughtException`: the stack goes to `logs/crash.log` and `logs/last-crash.json`
 *   synchronously (local disk), then the process exits with code 1. Under
 *   `npm start` the supervisor (`scripts/supervise.cjs`) restarts it.
 * - `unhandledRejection`: logged, and the process keeps running. Node ≥ 15 would
 *   otherwise exit, and a rejected promise does not leave shared state half-written.
 *
 * See specs/crash-recovery.md.
 */
import path from 'path';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

export interface LastCrash {
  /** ISO timestamp of the crash. */
  at: string;
  /** One line: error message, exit code or signal. */
  reason: string;
}

export const STARTED_AT = new Date().toISOString();

let logsDir = path.join(process.cwd(), 'logs');

/** Overrides the log folder. Tests only. */
export function setLogsDirForTests(dir: string): void {
  logsDir = dir;
}

export function crashLogPath(): string {
  return path.join(logsDir, 'crash.log');
}

export function lastCrashPath(): string {
  return path.join(logsDir, 'last-crash.json');
}

/** First line of an error, used as the short reason in `last-crash.json`. */
export function crashReason(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`.split('\n')[0]!.slice(0, 300);
  return String(err).split('\n')[0]!.slice(0, 300);
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`;
  return String(err);
}

/** Appends one entry to `logs/crash.log`. Never throws. */
export function appendCrashLog(kind: string, err: unknown): void {
  try {
    mkdirSync(logsDir, { recursive: true });
    appendFileSync(crashLogPath(), `[${new Date().toISOString()}] ${kind} (pid ${process.pid})\n${errorText(err)}\n\n`);
  } catch { /* logging must never cause a second crash */ }
}

/** Writes `logs/last-crash.json`. Never throws. */
export function writeLastCrash(reason: string): void {
  try {
    mkdirSync(logsDir, { recursive: true });
    const entry: LastCrash = { at: new Date().toISOString(), reason };
    writeFileSync(lastCrashPath(), JSON.stringify(entry, null, 2) + '\n');
  } catch { /* ignore */ }
}

/** Reads `logs/last-crash.json`, or `null` when missing or malformed. */
export function readLastCrash(): LastCrash | null {
  try {
    const parsed = JSON.parse(readFileSync(lastCrashPath(), 'utf8')) as Partial<LastCrash>;
    if (typeof parsed.at !== 'string' || typeof parsed.reason !== 'string') return null;
    return { at: parsed.at, reason: parsed.reason };
  } catch {
    return null;
  }
}

let installed = false;

/** Installs the process-level handlers. Idempotent. */
export function installCrashHandlers(): void {
  if (installed) return;
  installed = true;

  process.on('uncaughtException', (err) => {
    console.error('[crash] uncaughtException — exiting:', err);
    appendCrashLog('uncaughtException', err);
    writeLastCrash(crashReason(err));
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[crash] unhandledRejection — still running:', reason);
    appendCrashLog('unhandledRejection (Server läuft weiter)', reason);
  });
}
