#!/usr/bin/env tsx

/**
 * Media Encrypt/Decrypt Tool
 *
 * Encrypts each media folder into its own archive (<folder>.tar.gz.enc) for safe
 * storage in a public git repo. Uses Node.js built-in crypto (AES-256-GCM).
 *
 * Usage:
 *   npx tsx media-crypt.ts encrypt          # Encrypt all media folders
 *   npx tsx media-crypt.ts decrypt          # Decrypt all .tar.gz.enc files
 *   npx tsx media-crypt.ts encrypt audio    # Encrypt only the audio folder
 *   npx tsx media-crypt.ts decrypt audio    # Decrypt only audio.tar.gz.enc
 *
 * You will be prompted for a password each time.
 * Alternatively, set the MEDIA_KEY environment variable to skip the prompt.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MEDIA_DIRS = ['audio', 'audio-guess', 'background-music', 'image-guess', 'images'];

function archivePath(folder: string): string {
  return join(__dirname, `${folder}.tar.gz`);
}

function encryptedPath(folder: string): string {
  return join(__dirname, `${folder}.tar.gz.enc`);
}

function promptPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function getPassword(confirm = false): Promise<string> {
  if (process.env.MEDIA_KEY) return process.env.MEDIA_KEY;

  const password = await promptPassword('🔑 Password: ');
  if (!password) {
    console.error('❌ Password cannot be empty.');
    process.exit(1);
  }

  if (confirm) {
    const again = await promptPassword('🔑 Confirm password: ');
    if (password !== again) {
      console.error('❌ Passwords do not match.');
      process.exit(1);
    }
  }

  return password;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32);
}

function encryptFolder(folder: string, password: string): void {
  const folderPath = join(__dirname, folder);
  const archive = archivePath(folder);
  const encrypted = encryptedPath(folder);

  if (!existsSync(folderPath)) {
    console.log(`  ⏭️  ${folder}/ not found, skipping`);
    return;
  }

  // Create tar.gz archive — exclude backup folders and .gitignore files
  execSync(
    `tar -czf "${archive}" --exclude='*/backup' --exclude='*/backup/*' --exclude='.gitignore' ${folder}`,
    { cwd: __dirname, stdio: 'pipe' }
  );

  const archiveData = readFileSync(archive);
  const sizeMB = (archiveData.length / 1024 / 1024).toFixed(1);

  const salt = randomBytes(32);
  const derivedKey = deriveKey(password, salt);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', derivedKey, iv);

  const encData = Buffer.concat([cipher.update(archiveData), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // File format: [salt:32][iv:16][authTag:16][encrypted data]
  writeFileSync(encrypted, Buffer.concat([salt, iv, authTag, encData]));
  unlinkSync(archive);

  console.log(`  ✅ ${folder}/ → ${folder}.tar.gz.enc (${sizeMB} MB)`);
}

function decryptFolder(folder: string, password: string): void {
  const archive = archivePath(folder);
  const encrypted = encryptedPath(folder);

  if (!existsSync(encrypted)) {
    console.log(`  ⏭️  ${folder}.tar.gz.enc not found, skipping`);
    return;
  }

  const data = readFileSync(encrypted);
  const salt = data.subarray(0, 32);
  const iv = data.subarray(32, 48);
  const authTag = data.subarray(48, 64);
  const encData = data.subarray(64);

  const derivedKey = deriveKey(password, salt);
  const decipher = createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted: Buffer;
  try {
    decrypted = Buffer.concat([decipher.update(encData), decipher.final()]);
  } catch {
    console.error(`  ❌ ${folder}.tar.gz.enc — wrong password or corrupted file.`);
    process.exit(1);
  }

  writeFileSync(archive, decrypted);
  execSync(`tar -xzf "${archive}"`, { cwd: __dirname, stdio: 'pipe' });
  unlinkSync(archive);

  console.log(`  ✅ ${folder}.tar.gz.enc → ${folder}/`);
}

async function encrypt(folders: string[]): Promise<void> {
  const password = await getPassword(true);

  console.log('🔒 Encrypting...');
  for (const folder of folders) {
    encryptFolder(folder, password);
  }
  console.log('✅ Done! Commit the .tar.gz.enc files to git.');
}

async function decrypt(folders: string[]): Promise<void> {
  const password = await getPassword();

  console.log('🔓 Decrypting...');
  for (const folder of folders) {
    decryptFolder(folder, password);
  }
  console.log('✅ Media files decrypted and extracted.');
}

// --- CLI ---
const command = process.argv[2];
const folderArg = process.argv[3];
const folders = folderArg
  ? (MEDIA_DIRS.includes(folderArg) ? [folderArg] : (console.error(`❌ Unknown folder: ${folderArg}\nValid: ${MEDIA_DIRS.join(', ')}`), process.exit(1), []))
  : MEDIA_DIRS;

switch (command) {
  case 'encrypt':
    await encrypt(folders);
    break;
  case 'decrypt':
    await decrypt(folders);
    break;
  default:
    console.log(`Usage: npx tsx media-crypt.ts <command> [folder]

Commands:
  encrypt [folder]  Encrypt media folders → <folder>.tar.gz.enc
  decrypt [folder]  Decrypt <folder>.tar.gz.enc → folders

Folders: ${MEDIA_DIRS.join(', ')}
Omit folder to process all.

You will be prompted for a password. Set MEDIA_KEY env var to skip the prompt.`);
    process.exit(command ? 1 : 0);
}
