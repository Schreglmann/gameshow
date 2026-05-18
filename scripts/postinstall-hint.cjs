#!/usr/bin/env node
// Reminder after `npm install` for optional AI tools (Whisper, upscaler).

const fs = require('fs');
const path = require('path');

if (process.env.CI || process.env.GAMESHOW_SKIP_POSTINSTALL_HINT) process.exit(0);

const REPO_ROOT = path.resolve(__dirname, '..');
const platformKey = `${process.platform}-${process.arch}`;

const onPath = (cmd) =>
  (process.env.PATH || '')
    .split(path.delimiter)
    .some((dir) => dir && fs.existsSync(path.join(dir, cmd)));

const whisperInstalled =
  (!!process.env.WHISPER_CPP_BIN && fs.existsSync(process.env.WHISPER_CPP_BIN)) ||
  fs.existsSync(path.join(REPO_ROOT, 'local-assets', '.whisper-build', 'whisper-cli')) ||
  onPath('whisper-cli') ||
  onPath('whisper-cpp') ||
  onPath('whisper');

const upscalerInstalled = fs.existsSync(
  path.join(REPO_ROOT, 'local-assets', '.upscaler', platformKey, 'upscayl-bin'),
);

const upscalerSupported = ['darwin-arm64', 'darwin-x64', 'linux-x64'].includes(platformKey);
const whisperSupported = process.platform === 'darwin' || process.platform === 'linux';

const lines = [];
if (whisperSupported && !whisperInstalled) {
  lines.push(['npm run whisper:install', 'Whisper video transcription (~1.5 GB model)']);
}
if (upscalerSupported && !upscalerInstalled) {
  lines.push(['npm run upscaler:install', 'Local-AI image upscaler for the DAM (~150 MB)']);
}

if (lines.length === 0) process.exit(0);

const tty = process.stdout.isTTY;
const cyan = (s) => (tty ? `\x1b[36m${s}\x1b[0m` : s);
const bold = (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
const dim = (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s);

const maxCmd = Math.max(...lines.map(([c]) => c.length));

process.stdout.write('\n');
process.stdout.write(bold('Optional AI tools not yet installed:') + '\n');
for (const [cmd, desc] of lines) {
  process.stdout.write(`  ${cyan(cmd.padEnd(maxCmd))}  ${dim('—')} ${desc}\n`);
}
process.stdout.write(dim('  (suppress with GAMESHOW_SKIP_POSTINSTALL_HINT=1)') + '\n\n');
