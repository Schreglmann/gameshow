#!/usr/bin/env node
'use strict';
/**
 * Scoped verification — runs only the gates the current change set can affect.
 *
 * The full suite is ~53s (188 files / 2324 tests). Most changes can only break a
 * handful of those, so this derives the change set from git, classifies it, and
 * runs the affected gates only. Doc-only changes run nothing.
 *
 *   node scripts/verify-changed.cjs               # working tree (npm run verify)
 *   node scripts/verify-changed.cjs --stop-hook   # working tree, blocking (Claude Stop hook)
 *   node scripts/verify-changed.cjs --staged       # staged only (.githooks/pre-commit)
 *   node scripts/verify-changed.cjs --full         # every gate (.githooks/pre-push, pre-show)
 *
 * Debug/testing affordances:
 *   --dry-run              print the selected gates, run nothing
 *   --files a.ts b.tsx     override change detection with an explicit list
 *   --no-cache             ignore the pass cache
 *
 * Exit codes: 0 = passed / nothing to verify · 1 = a gate failed
 *             2 = a gate failed under --stop-hook (blocking; stderr returns to the agent)
 *
 * Policy notes live in AGENTS.md §7 (Verification). FULL_SUITE_TRIGGERS below is
 * the authoritative copy of the escalation list.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const STAGED = has('--staged');
const FULL = has('--full');
const STOP_HOOK = has('--stop-hook');
const DRY_RUN = has('--dry-run');
const NO_CACHE = has('--no-cache');

/* ------------------------------------------------------------------ policy */

/**
 * Changes whose blast radius is either the whole app or invisible to vitest's
 * module graph. Mirrored in AGENTS.md §7; this list is the authoritative one.
 */
const FULL_SUITE_TRIGGERS = new Set([
  'src/types/config.ts',
  'src/types/game.ts',
  'src/context/GameContext.tsx',
  'src/components/games/BaseGameWrapper.tsx',
  // String-keyed switch on config.type — no import edge from most game tests.
  'src/components/games/GameFactory.tsx',
  'src/components/common/AwardPoints.tsx',
  'src/services/api.ts',
  // No test imports server/index.ts, so `vitest related` would select 0 files.
  'server/index.ts',
  'server/ws.ts',
  'server/whisper-jobs.ts',
  'validate-config.ts',
  // Test infrastructure: changes here can affect every spec.
  'tests/setup.ts',
  'vitest.config.ts',
  'package.json',
]);

/** Beyond this, scoping stops paying for itself — just run everything. */
const MAX_SCOPED_TEST_TARGETS = 40;

/**
 * Tests that read fixtures off disk instead of importing them, so no module
 * edge exists for `vitest related` to follow.
 */
const GAME_CONTENT_TESTS = [
  'tests/unit/games/json-trailing-newline.test.ts',
  'tests/integration/server/ServerLogic.test.ts',
];
/** Same story for the API YAMLs — loaded via tests/contracts/schema-loader.ts. */
const CONTRACT_TESTS = [
  'tests/contracts/openapi-contract.test.ts',
  'tests/contracts/asyncapi-contract.test.ts',
];

/* --------------------------------------------------------------------- git */

const git = (...args) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.split('\0').filter(Boolean) : [];
};

// --diff-filter=ACMR drops deletions: a removed file has nothing left to check.
const stagedFiles = () => git('diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR');
// `git diff` alone would miss untracked files, so a new component + its new test
// would verify nothing. --exclude-standard keeps gitignored noise out.
const worktreeFiles = () => git('ls-files', '--modified', '--others', '--exclude-standard', '-z');

const explicitIdx = argv.indexOf('--files');
const detected =
  explicitIdx !== -1
    ? argv.slice(explicitIdx + 1).filter((a) => !a.startsWith('--'))
    : STAGED
      ? stagedFiles()
      : [...stagedFiles(), ...worktreeFiles()];

const files = [...new Set(detected)].sort();

/* -------------------------------------------------------- classification */

const exists = (p) => fs.existsSync(path.join(ROOT, p));
const isTs = (p) => /\.tsx?$/.test(p);
const isTestable = (p) => /^(src|server|tests)\/.+\.tsx?$/.test(p);
// Two separate tsc programs, kept apart on purpose. `tsc -b` on the root project
// never reuses its buildinfo (build mode judges up-to-dateness from output files,
// and noEmit:true produces none), so it costs a flat ~7s. Plain `-p --incremental`
// with its own buildinfo is ~1.4s warm. tsconfig.node.json IS composite, so `-b`
// works properly there (~0.8s no-op) and still covers the vite configs.
const inSrcProgram = (p) =>
  /^src\/.+\.tsx?$/.test(p) || p === 'vite-env.d.ts' || p === 'tsconfig.json';
const inNodeProgram = (p) =>
  /^vite\.config\.[a-z]+\.ts$/.test(p) || p === 'tsconfig.node.json' || p === 'tsconfig.json';
const inServerProgram = (p) =>
  /^server\/.+\.ts$/.test(p) || /^src\/types\/.+\.ts$/.test(p) || p === 'tsconfig.server.json';
const isGameContent = (p) => p === 'config.json' || /^games\/.+\.json$/.test(p);
const isJson = (p) => p.endsWith('.json') && p !== 'package-lock.json';
const isApiSpec = (p) => /^specs\/api\/.+\.ya?ml$/.test(p);

const testTargets = new Set(files.filter(isTestable));
if (files.some(isJson)) testTargets.add(GAME_CONTENT_TESTS[0]); // trailing-newline check covers every JSON
if (files.some(isGameContent)) GAME_CONTENT_TESTS.forEach((t) => testTargets.add(t));
if (files.some(isApiSpec)) CONTRACT_TESTS.forEach((t) => testTargets.add(t));

const needsFullSuite =
  FULL ||
  files.some((p) => FULL_SUITE_TRIGGERS.has(p)) ||
  testTargets.size > MAX_SCOPED_TEST_TARGETS;

// eslint.config.js is itself in the ignore list, so a rule change needs a full sweep.
const lintEverything = FULL || files.includes('eslint.config.js');
const lintTargets = files.filter((p) => isTs(p) && exists(p));

/* ---------------------------------------------------------------- task list */
// Cheapest first, so the common failure surfaces before the slow gates run.

const bin = (name) => {
  const local = path.join(ROOT, 'node_modules', '.bin', name);
  return fs.existsSync(local) ? local : name;
};

const tasks = [];

// Also on a validator change: editing the rules means re-running them over the content.
if (FULL || files.some(isGameContent) || files.includes('validate-config.ts'))
  tasks.push({
    name: 'validate (config + games)',
    // `node --import tsx/esm`, not the tsx CLI: the CLI opens an IPC unix socket
    // that fails with EPERM under a sandboxed shell, taking the whole gate down.
    cmd: process.execPath,
    args: ['--import', 'tsx/esm', 'validate-config.ts'],
  });

if (lintEverything) tasks.push({ name: 'lint (all)', cmd: bin('eslint'), args: ['.'] });
else if (lintTargets.length)
  tasks.push({
    name: `lint (${lintTargets.length} file${lintTargets.length === 1 ? '' : 's'})`,
    cmd: bin('eslint'),
    args: ['--no-warn-ignored', ...lintTargets],
  });

if (FULL || files.some(inServerProgram))
  tasks.push({
    name: 'typecheck (server)',
    cmd: bin('tsc'),
    // Own buildinfo: never share one between --noEmit here and the emitting `npm run build`.
    args: [
      '-p',
      'tsconfig.server.json',
      '--noEmit',
      '--incremental',
      '--tsBuildInfoFile',
      'node_modules/.cache/tsc-server-check.tsbuildinfo',
    ],
  });

if (FULL || files.some(inSrcProgram))
  tasks.push({
    name: 'typecheck (client)',
    cmd: bin('tsc'),
    args: [
      '-p',
      'tsconfig.json',
      '--noEmit',
      '--incremental',
      '--tsBuildInfoFile',
      'node_modules/.cache/tsc-client-check.tsbuildinfo',
    ],
  });

if (FULL || files.some(inNodeProgram))
  tasks.push({ name: 'typecheck (vite configs)', cmd: bin('tsc'), args: ['-b', 'tsconfig.node.json'] });

if (FULL || files.some(isApiSpec))
  // redocly/asyncapi resolve through npx, so keep the npm script that owns the config paths.
  tasks.push({ name: 'contracts:lint', cmd: 'npm', args: ['run', 'contracts:lint'] });

if (needsFullSuite)
  tasks.push({ name: 'test (full suite)', cmd: bin('vitest'), args: ['run', '--reporter=dot'] });
else if (testTargets.size)
  tasks.push({
    name: `test (related: ${testTargets.size} target${testTargets.size === 1 ? '' : 's'})`,
    cmd: bin('vitest'),
    // Passing a test file as a `related` target selects that file directly, so the
    // disk-reading and contract buckets fold into this one invocation.
    args: ['related', '--run', '--reporter=dot', ...[...testTargets].sort()],
  });

const label = (t) => [path.basename(t.cmd), ...t.args].join(' ');

if (DRY_RUN) {
  console.log(`files (${files.length}):${files.length ? '\n  ' + files.join('\n  ') : ' none'}`);
  console.log(`gates (${tasks.length}):${tasks.length ? '' : ' none'}`);
  for (const t of tasks) console.log(`  ${t.name}\n    $ ${label(t)}`);
  process.exit(0);
}

if (!tasks.length) {
  if (!STOP_HOOK)
    console.log(`verify: nothing to check (${files.length} changed file(s), no gate affected)`);
  process.exit(0);
}

/* ------------------------------------------------------------------ caching */
// Turns that changed nothing (questions, planning, reading) must cost ~nothing
// even when the working tree is still dirty from earlier turns.

const CACHE_FILE = path.join(ROOT, 'node_modules', '.cache', 'verify-changed.json');
const signature = (() => {
  const h = crypto.createHash('sha1').update('v1\0' + tasks.map((t) => label(t)).join('|'));
  for (const p of files) {
    let stamp = 'gone';
    try {
      const s = fs.statSync(path.join(ROOT, p));
      stamp = `${s.size}:${s.mtimeMs}`;
    } catch {
      /* deleted between detection and hashing — the 'gone' stamp is the signal */
    }
    h.update(`\0${p}:${stamp}`);
  }
  return h.digest('hex');
})();

if (!NO_CACHE) {
  try {
    if (JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')).pass === signature) {
      if (!STOP_HOOK) console.log('verify: unchanged since last pass (cached)');
      process.exit(0);
    }
  } catch {
    /* no cache yet, or unreadable — just run the gates */
  }
}

/* ------------------------------------------------------------------- runner */

const started = Date.now();
for (const t of tasks) {
  process.stdout.write(`\n▸ ${t.name}\n`);
  const r = spawnSync(t.cmd, t.args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    process.stderr.write(
      `\nverify-changed: ${t.name} FAILED.\n` +
        `Reproduce: ${label(t)}\n` +
        `Fix it before finishing (AGENTS.md §7). Full sweep: npm run verify:full\n`
    );
    process.exit(STOP_HOOK && !stopHookAlreadyBlocked() ? 2 : 1);
  }
}

try {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify({ pass: signature }) + '\n');
} catch {
  /* cache is an optimisation — a failure to write must not fail the gate */
}

console.log(
  `\n✓ verify: ${tasks.length} gate(s) passed in ${((Date.now() - started) / 1000).toFixed(1)}s` +
    ` (${files.length} changed file(s))`
);

/**
 * A Stop hook that blocks on every attempt can loop, so only block the first
 * time. Claude Code passes `stop_hook_active` in the hook's stdin JSON. Reading
 * stdin is guarded three ways — only under --stop-hook, never on a TTY (where
 * the read would block waiting for input), and in try/catch — because a hung
 * read here would hang the whole turn. Losing the guard is the safe failure.
 */
function stopHookAlreadyBlocked() {
  if (!STOP_HOOK || process.stdin.isTTY) return false;
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8')).stop_hook_active === true;
  } catch {
    return false;
  }
}
