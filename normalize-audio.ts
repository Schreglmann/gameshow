#!/usr/bin/env tsx

/**
 * Audio Normalizer
 * Normalizes audio files using ffmpeg's loudnorm filter to target -16 LUFS
 * Supports: mp3, wav, ogg, m4a, opus (opus files are converted to m4a)
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import ffmpegStatic from 'ffmpeg-static';

const FFMPEG = ffmpegStatic ?? 'ffmpeg';

// ─── Configuration ───────────────────────────────────────────
const AUDIO_DIR = path.resolve('.');
const SUPPORTED_EXT = ['.mp3', '.wav', '.ogg', '.m4a', '.opus'];
const TARGET_LUFS = -16;
const BACKUP_DIR_NAME = 'backup';
const LUFS_TOLERANCE = 0.5;

// ─── Check ffmpeg availability ───────────────────────────────
function checkFfmpeg(): void {
  try {
    execSync(`"${FFMPEG}" -version`, { stdio: 'ignore' });
  } catch {
    console.error('❌ ffmpeg not found! Please install ffmpeg first.');
    console.error('   brew install ffmpeg  (macOS)');
    console.error('   apt install ffmpeg   (Linux)');
    process.exit(1);
  }
}

// ─── Find audio files recursively ────────────────────────────
function findAudioFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules, .git, backup dirs
        if (['node_modules', '.git', 'dist', 'backup'].includes(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXT.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return results;
}

// ─── Analyze loudness ────────────────────────────────────────
interface LoudnessInfo {
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
}

function analyzeLoudness(filePath: string): LoudnessInfo | null {
  try {
    const cmd = `"${FFMPEG}" -i "${filePath}" -af loudnorm=print_format=json -f null - 2>&1`;
    const output = execSync(cmd, { encoding: 'utf-8' });

    // Extract the JSON block from ffmpeg output
    const jsonMatch = output.match(/\{[^}]+input_i[^}]+\}/s);
    if (!jsonMatch) return null;

    const data = JSON.parse(jsonMatch[0]);
    return {
      inputI: parseFloat(data.input_i),
      inputTp: parseFloat(data.input_tp),
      inputLra: parseFloat(data.input_lra),
      inputThresh: parseFloat(data.input_thresh),
    };
  } catch {
    return null;
  }
}

// ─── Normalize audio file ────────────────────────────────────
function normalizeFile(filePath: string, dryRun: boolean = false, force: boolean = false): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const relativePath = path.relative(AUDIO_DIR, filePath);

  // Fast path: if a backup already exists, this file was already normalized
  const fileDir = path.dirname(filePath);
  const backupDir = path.join(fileDir, BACKUP_DIR_NAME);
  const backupPath = path.join(backupDir, path.basename(filePath));
  if (!force && fs.existsSync(backupPath)) {
    console.log(`\n⚡ Skipping (already normalized): ${relativePath}`);
    return true;
  }

  console.log(`\n📊 Analyzing: ${relativePath}`);

  const loudness = analyzeLoudness(filePath);
  if (!loudness) {
    console.log('   ⚠️  Could not analyze loudness, skipping.');
    return false;
  }

  const diff = Math.abs(loudness.inputI - TARGET_LUFS);
  console.log(`   Current: ${loudness.inputI.toFixed(1)} LUFS (target: ${TARGET_LUFS} LUFS, diff: ${diff.toFixed(1)})`);

  if (diff < LUFS_TOLERANCE) {
    console.log('   ✅ Already normalized, skipping.');
    // Create placeholder so future runs skip ffmpeg entirely (don't overwrite a real backup)
    if (!dryRun) {
      const backupExists = fs.existsSync(backupPath);
      const backupIsReal = backupExists && fs.statSync(backupPath).size > 0;
      if (!backupIsReal) {
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(backupPath, '');
        console.log('   📌 Placeholder backup created for fast future skips.');
      }
    }
    return true;
  }

  if (dryRun) {
    console.log('   🔍 [DRY RUN] Would normalize this file.');
    return true;
  }

  // Create backup in backup/ subdirectory — skip if real backup already exists
  fs.mkdirSync(backupDir, { recursive: true });
  const existingBackupSize = fs.existsSync(backupPath) ? fs.statSync(backupPath).size : -1;
  if (existingBackupSize <= 0) {
    fs.copyFileSync(filePath, backupPath);
    console.log('   💾 Backup created.');
  } else {
    console.log('   💾 Backup already exists, keeping original.');
  }

  // Determine output format
  let outputPath = filePath;
  let outputArgs = '';

  if (ext === '.opus') {
    // Convert opus to m4a (better compatibility)
    outputPath = filePath.replace(/\.opus$/i, '.m4a');
    outputArgs = '-c:a aac -b:a 192k';
    console.log('   🔄 Converting opus → m4a');
  } else if (ext === '.mp3') {
    outputArgs = '-c:a libmp3lame -b:a 192k';
  } else if (ext === '.m4a') {
    outputArgs = '-c:a aac -b:a 192k';
  } else if (ext === '.ogg') {
    outputArgs = '-c:a libvorbis -b:a 192k';
  } else if (ext === '.wav') {
    outputArgs = '-c:a pcm_s16le';
  }

  const tempPath = filePath + '.tmp' + (ext === '.opus' ? '.m4a' : ext);

  try {
    const cmd = [
      `"${FFMPEG}"`, '-y',
      '-i', `"${filePath}"`,
      '-af', `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:measured_I=${loudness.inputI}:measured_TP=${loudness.inputTp}:measured_LRA=${loudness.inputLra}:measured_thresh=${loudness.inputThresh}:linear=true`,
      outputArgs,
      `"${tempPath}"`,
    ].filter(Boolean).join(' ');

    execSync(cmd, { stdio: 'ignore' });

    // Replace original
    if (outputPath !== filePath && fs.existsSync(outputPath)) {
      // If converting opus→m4a and m4a already exists, back it up first
      const opusBackupDir = path.join(path.dirname(outputPath), BACKUP_DIR_NAME);
      fs.mkdirSync(opusBackupDir, { recursive: true });
      fs.copyFileSync(outputPath, path.join(opusBackupDir, path.basename(outputPath)));
    }

    fs.renameSync(tempPath, outputPath);

    if (ext === '.opus' && outputPath !== filePath) {
      // Remove original opus file after successful conversion
      fs.unlinkSync(filePath);
      console.log(`   ✅ Normalized and converted to: ${path.basename(outputPath)}`);
    } else {
      console.log('   ✅ Normalized successfully.');
    }

    return true;
  } catch (error) {
    console.log(`   ❌ Normalization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    // Clean up temp file
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    return false;
  }
}

// ─── Restore backups ─────────────────────────────────────────
function restoreBackups(): void {
  console.log('\n🔄 Restoring backups...\n');
  let restored = 0;

  // Find files inside backup/ subdirectories
  function findBackupFiles(dir: string): string[] {
    const results: string[] = [];
    function walk(currentDir: string): void {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
          if (entry.name === BACKUP_DIR_NAME) {
            // Collect all files inside this backup dir
            const backupEntries = fs.readdirSync(fullPath, { withFileTypes: true });
            for (const be of backupEntries) {
              if (be.isFile()) results.push(path.join(fullPath, be.name));
            }
          } else {
            walk(fullPath);
          }
        }
      }
    }
    walk(dir);
    return results;
  }

  const backups = findBackupFiles(AUDIO_DIR);
  for (const backup of backups) {
    // Restore to parent directory of the backup/ folder
    const original = path.join(path.dirname(path.dirname(backup)), path.basename(backup));
    fs.copyFileSync(backup, original);
    fs.unlinkSync(backup);
    console.log(`   ✅ Restored: ${path.relative(AUDIO_DIR, original)}`);
    restored++;
  }

  console.log(`\n✅ Restored ${restored} files.`);
}

// ─── Clean backups ───────────────────────────────────────────
function cleanBackups(): void {
  console.log('\n🧹 Cleaning backups...\n');

  // Find all backup/ subdirectories
  function findBackupDirs(dir: string): string[] {
    const results: string[] = [];
    function walk(currentDir: string): void {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
          if (entry.name === BACKUP_DIR_NAME) {
            results.push(fullPath);
          } else {
            walk(fullPath);
          }
        }
      }
    }
    walk(dir);
    return results;
  }

  const backupDirs = findBackupDirs(AUDIO_DIR);
  let removed = 0;
  for (const dir of backupDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`   🗑️  Removed: ${path.relative(AUDIO_DIR, dir)}/`);
    removed++;
  }

  console.log(`\n✅ Removed ${removed} backup folder(s).`);
}

// ─── Main ────────────────────────────────────────────────────
function main(): void {
  const args = process.argv.slice(2);
  const command = args[0] || 'normalize';
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  switch (command) {
    case 'normalize': {
      checkFfmpeg();
      console.log('🎵 Audio Normalizer');
      console.log(`   Target: ${TARGET_LUFS} LUFS`);
      console.log(`   Directory: ${AUDIO_DIR}`);
      if (dryRun) console.log('   Mode: DRY RUN (no changes will be made)');
      if (force) console.log('   Mode: FORCE (re-analyzing all files, ignoring backups)');
      console.log('');

      const files = findAudioFiles(AUDIO_DIR);
      console.log(`Found ${files.length} audio files.`);

      let success = 0;
      let failed = 0;

      for (const file of files) {
        const result = normalizeFile(file, dryRun, force);
        if (result) success++;
        else failed++;
      }

      console.log('\n────────────────────────────────');
      console.log(`✅ Success/Skipped: ${success}`);
      console.log(`❌ Failed: ${failed}`);
      break;
    }

    case 'restore':
      restoreBackups();
      break;

    case 'clean':
      cleanBackups();
      break;

    default:
      console.log('Usage: normalize-audio [command] [options]');
      console.log('');
      console.log('Commands:');
      console.log('  normalize   Normalize all audio files (default)');
      console.log('  restore     Restore original files from backups');
      console.log('  clean       Remove backup files');
      console.log('');
      console.log('Options:');
      console.log('  --dry-run   Show what would be done without making changes');
      console.log('  --force     Re-analyze all files, ignoring existing backups');
  }
}

main();
