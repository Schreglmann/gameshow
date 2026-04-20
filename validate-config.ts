#!/usr/bin/env tsx

/**
 * Config Validator
 * Validates config.json and all referenced game files in games/
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { GameType, AppConfig, GameConfig } from './src/types/config.js';
import { JOKER_CATALOG } from './src/data/jokers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * git-crypt magic header — encrypted files begin with these bytes when the
 * repo is checked out without the unlock key. See specs/clean-install.md.
 */
const GIT_CRYPT_MAGIC = Buffer.from([0x00, 0x47, 0x49, 0x54, 0x43, 0x52, 0x59, 0x50, 0x54, 0x00]);

function isGitCryptBlob(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(GIT_CRYPT_MAGIC.length);
    const bytesRead = fs.readSync(fd, head, 0, GIT_CRYPT_MAGIC.length, 0);
    fs.closeSync(fd);
    return bytesRead === GIT_CRYPT_MAGIC.length && head.equals(GIT_CRYPT_MAGIC);
  } catch {
    return false;
  }
}

const VALID_THEMES = ['galaxia', 'harry-potter', 'dnd', 'arctic', 'enterprise', 'retro'];

const VALID_GAME_TYPES: GameType[] = [
  'simple-quiz',
  'bet-quiz',
  'guessing-game',
  'final-quiz',
  'audio-guess',
  'video-guess',
  'q1',
  'four-statements',
  'fact-or-fake',
  'quizjagd',
  'bandle',
  'image-guess',
];

function parseGameRef(ref: string): { gameName: string; instanceName: string | null } {
  const slashIdx = ref.indexOf('/');
  if (slashIdx === -1) return { gameName: ref, instanceName: null };
  return { gameName: ref.slice(0, slashIdx), instanceName: ref.slice(slashIdx + 1) };
}

function loadGameConfig(gameName: string, instanceName: string | null): GameConfig {
  const filePath = path.join(__dirname, 'games', `${gameName}.json`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Game file not found: games/${gameName}.json`);
  }

  const data = fs.readFileSync(filePath, 'utf8');
  let fileContent: Record<string, unknown>;
  try {
    fileContent = JSON.parse(data);
  } catch {
    throw new Error(`Invalid JSON in games/${gameName}.json`);
  }

  if ('instances' in fileContent && fileContent.instances) {
    const { instances, ...base } = fileContent;
    const instanceMap = instances as Record<string, Record<string, unknown>>;
    if (!instanceName) {
      throw new Error(`Game "${gameName}" has multiple instances but no instance specified. Available: ${Object.keys(instanceMap).join(', ')}`);
    }
    if (instanceName.toLowerCase() === 'archive') {
      throw new Error(`Instance "${instanceName}" in "${gameName}" is reserved for archived questions and cannot be used in gameOrder`);
    }
    const instance = instanceMap[instanceName];
    if (!instance) {
      throw new Error(`Instance "${instanceName}" not found in "${gameName}". Available: ${Object.keys(instanceMap).filter(k => k.toLowerCase() !== 'archive').join(', ')}`);
    }
    return { ...base, ...instance } as unknown as GameConfig;
  }

  if (instanceName) {
    throw new Error(`Game "${gameName}" is single-instance but instance "${instanceName}" was specified`);
  }
  return fileContent as unknown as GameConfig;
}

function validateConfig(): void {
  const configPath = path.join(__dirname, 'config.json');

  console.log('🔍 Validating config.json and game files...\n');

  if (!fs.existsSync(configPath)) {
    console.error('❌ Error: config.json not found!');
    console.log('💡 Tip: Create a config.json with gameOrder referencing games in games/');
    process.exit(1);
  }

  if (isGitCryptBlob(configPath)) {
    console.log('🔒 config.json is git-crypt encrypted — skipping validation.');
    console.log('   (On a fresh clone without the unlock key, the server falls back');
    console.log('   to a template-based default. See specs/clean-install.md.)');
    process.exit(0);
  }

  let config: AppConfig;
  try {
    const data = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(data);
  } catch (err) {
    console.error('❌ Error: Invalid JSON in config.json');
    console.error((err as Error).message);
    process.exit(1);
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate "games" key is NOT present (old format)
  if ('games' in config) {
    errors.push('"games" object found in config.json — this is the old format. Games should be in individual files under games/');
  }

  // Validate gameshows & activeGameshow
  if (!config.gameshows || typeof config.gameshows !== 'object') {
    errors.push('Missing "gameshows" object');
  }

  if (!config.activeGameshow) {
    errors.push('Missing "activeGameshow" string');
  } else if (config.gameshows && !(config.activeGameshow in config.gameshows)) {
    errors.push(`"activeGameshow" value "${config.activeGameshow}" not found in "gameshows". Available: ${Object.keys(config.gameshows).join(', ')}`);
  }

  // Collect all referenced game names across all gameshows
  const allReferencedGames = new Set<string>();

  // Validate each gameshow
  if (config.gameshows && typeof config.gameshows === 'object') {
    for (const [showKey, show] of Object.entries(config.gameshows)) {
      if (!show.name) {
        warnings.push(`Gameshow "${showKey}": missing "name" field`);
      }
      if (show.enabledJokers !== undefined) {
        if (!Array.isArray(show.enabledJokers)) {
          errors.push(`Gameshow "${showKey}": "enabledJokers" must be an array`);
        } else {
          const validIds = new Set(JOKER_CATALOG.map(j => j.id));
          show.enabledJokers.forEach((jokerId, idx) => {
            if (typeof jokerId !== 'string') {
              errors.push(`Gameshow "${showKey}" enabledJokers[${idx}]: must be a string`);
            } else if (!validIds.has(jokerId)) {
              errors.push(
                `Gameshow "${showKey}" enabledJokers[${idx}]: unknown joker id "${jokerId}". Valid ids: ${[...validIds].join(', ')}`
              );
            }
          });
        }
      }

      if (!show.gameOrder) {
        errors.push(`Gameshow "${showKey}": missing "gameOrder" array`);
      } else if (!Array.isArray(show.gameOrder)) {
        errors.push(`Gameshow "${showKey}": "gameOrder" must be an array`);
      } else if (show.gameOrder.length === 0) {
        warnings.push(`Gameshow "${showKey}": gameOrder is empty`);
      } else {
        show.gameOrder.forEach((gameRef: string, index: number) => {
          const { gameName, instanceName } = parseGameRef(gameRef);
          allReferencedGames.add(gameName);

          let gameConfig: GameConfig;
          try {
            gameConfig = loadGameConfig(gameName, instanceName);
          } catch (err) {
            errors.push(`Gameshow "${showKey}" gameOrder[${index}] "${gameRef}": ${(err as Error).message}`);
            return;
          }

          const gameErrors = validateGame(gameRef, gameConfig);
          errors.push(...gameErrors);
        });
      }
    }
  }

  // Also validate all game files in games/ directory
  const gamesDir = path.join(__dirname, 'games');
  if (fs.existsSync(gamesDir)) {
    const gameFiles = fs.readdirSync(gamesDir).filter(f => f.endsWith('.json') && !f.startsWith('_template') && !f.includes('.fingerprints.'));

    for (const file of gameFiles) {
      // Skip encrypted blobs — these are expected on a partial clone and are
      // not validation failures.
      if (isGitCryptBlob(path.join(gamesDir, file))) continue;
      const gameName = file.replace(/\.json$/, '');
      if (!allReferencedGames.has(gameName)) {
        warnings.push(`Game file "games/${file}" exists but is not referenced in any gameshow`);
      }
    }
  }

  // Summary
  if (errors.length > 0) {
    console.error('❌ Validation failed with errors:\n');
    errors.forEach(error => console.error(`  • ${error}`));
    console.log('');
  }

  if (warnings.length > 0) {
    console.warn('⚠️  Warnings:\n');
    warnings.forEach(warning => console.warn(`  • ${warning}`));
    console.log('');
  }

  if (errors.length === 0) {
    const gameshowCount = Object.keys(config.gameshows).length;
    const activeShow = config.gameshows[config.activeGameshow];
    console.log('✅ Configuration is valid!');
    console.log(`📊 ${gameshowCount} gameshow(s) defined, active: "${config.activeGameshow}"`);
    console.log(`🎮 Active game order: ${activeShow.gameOrder.join(' → ')}\n`);
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

function validateGame(gameRef: string, game: GameConfig): string[] {
  const errors: string[] = [];

  if (!game.type) {
    errors.push(`Game "${gameRef}": missing "type" field`);
  } else if (!VALID_GAME_TYPES.includes(game.type)) {
    errors.push(
      `Game "${gameRef}": invalid type "${game.type}". Valid types: ${VALID_GAME_TYPES.join(', ')}`
    );
  }

  if (!game.title) {
    errors.push(`Game "${gameRef}": missing "title" field`);
  }

  if (game.theme !== undefined) {
    if (typeof game.theme !== 'string' || !VALID_THEMES.includes(game.theme)) {
      errors.push(
        `Game "${gameRef}": invalid theme "${game.theme}". Valid themes: ${VALID_THEMES.join(', ')}`
      );
    }
  }

  if (game.questionLimit !== undefined) {
    if (typeof game.questionLimit !== 'number' || game.questionLimit < 1 || !Number.isInteger(game.questionLimit)) {
      errors.push(`Game "${gameRef}": "questionLimit" must be a positive integer`);
    }
  }

  const typesNeedingQuestions: GameType[] = [
    'simple-quiz',
    'bet-quiz',
    'guessing-game',
    'final-quiz',
    'q1',
    'four-statements',
    'fact-or-fake',
    'audio-guess',
    'bandle',
    'image-guess',
  ];

  if (game.type && typesNeedingQuestions.includes(game.type)) {
    if (!('questions' in game) || !game.questions) {
      errors.push(`Game "${gameRef}": missing "questions" array`);
    } else if (!Array.isArray(game.questions)) {
      errors.push(`Game "${gameRef}": "questions" must be an array`);
    } else if (game.questions.length === 0) {
      errors.push(`Game "${gameRef}": "questions" array is empty`);
    } else {
      (game.questions as Record<string, unknown>[]).forEach((q: Record<string, unknown>, idx: number) => {
        const qErrors = validateQuestion(gameRef, game.type, q, idx);
        errors.push(...qErrors);
      });
    }
  }

  return errors;
}

function validateQuestion(
  gameRef: string,
  gameType: GameType,
  question: Record<string, unknown>,
  index: number
): string[] {
  const errors: string[] = [];

  switch (gameType) {
    case 'simple-quiz':
    case 'final-quiz':
      if (!question.question) errors.push(`Game "${gameRef}", question ${index}: missing "question"`);
      if (!question.answer) errors.push(`Game "${gameRef}", question ${index}: missing "answer"`);
      break;

    case 'bet-quiz':
      if (!question.question) errors.push(`Game "${gameRef}", question ${index}: missing "question"`);
      if (!question.answer) errors.push(`Game "${gameRef}", question ${index}: missing "answer"`);
      if (typeof question.category !== 'string' || !(question.category as string).trim())
        errors.push(`Game "${gameRef}", question ${index}: missing "category" (required for bet-quiz)`);
      break;

    case 'guessing-game':
      if (!question.question) errors.push(`Game "${gameRef}", question ${index}: missing "question"`);
      if (typeof question.answer !== 'number')
        errors.push(`Game "${gameRef}", question ${index}: "answer" must be a number`);
      break;

    case 'q1':
      if (!question.Frage) errors.push(`Game "${gameRef}", question ${index}: missing "Frage"`);
      if (!Array.isArray(question.trueStatements) || question.trueStatements.length === 0)
        errors.push(`Game "${gameRef}", question ${index}: missing or empty "trueStatements"`);
      if (!question.wrongStatement)
        errors.push(`Game "${gameRef}", question ${index}: missing "wrongStatement"`);
      break;

    case 'four-statements':
      if (typeof question.topic !== 'string' || !(question.topic as string).trim())
        errors.push(`Game "${gameRef}", question ${index}: missing "topic"`);
      if (!Array.isArray(question.statements) || (question.statements as unknown[]).length > 4) {
        errors.push(`Game "${gameRef}", question ${index}: "statements" must be an array of up to 4 entries`);
      } else if ((question.statements as unknown[]).some(s => typeof s !== 'string')) {
        errors.push(`Game "${gameRef}", question ${index}: every "statements" entry must be a string`);
      } else if ((question.statements as string[]).every(s => !s.trim())) {
        errors.push(`Game "${gameRef}", question ${index}: "statements" needs at least one non-empty entry`);
      }
      if (!question.answer && !question.answerImage)
        errors.push(`Game "${gameRef}", question ${index}: needs "answer" or "answerImage"`);
      break;

    case 'fact-or-fake':
      if (!question.statement) errors.push(`Game "${gameRef}", question ${index}: missing "statement"`);
      if (!['FAKT', 'FAKE'].includes(question.answer as string) && question.isFact === undefined)
        errors.push(`Game "${gameRef}", question ${index}: needs "answer" (FAKT/FAKE) or "isFact" (boolean)`);
      break;

    case 'audio-guess':
      if (!question.answer) errors.push(`Game "${gameRef}", question ${index}: missing "answer"`);
      if (!question.audio) errors.push(`Game "${gameRef}", question ${index}: missing "audio"`);
      break;

    case 'bandle':
      if (!question.answer) errors.push(`Game "${gameRef}", question ${index}: missing "answer"`);
      if (!Array.isArray(question.tracks) || question.tracks.length === 0) {
        errors.push(`Game "${gameRef}", question ${index}: missing or empty "tracks" array`);
      } else {
        (question.tracks as Array<Record<string, unknown>>).forEach((track, tIdx) => {
          if (!track.label) errors.push(`Game "${gameRef}", question ${index}, track ${tIdx}: missing "label"`);
          if (!track.audio) errors.push(`Game "${gameRef}", question ${index}, track ${tIdx}: missing "audio"`);
        });
      }
      break;

    case 'image-guess':
      if (!question.answer) errors.push(`Game "${gameRef}", question ${index}: missing "answer"`);
      if (!question.image) errors.push(`Game "${gameRef}", question ${index}: missing "image"`);
      if (question.obfuscation !== undefined && !['blur', 'pixelate', 'zoom', 'swirl', 'noise', 'scatter', 'random'].includes(question.obfuscation as string))
        errors.push(`Game "${gameRef}", question ${index}: "obfuscation" must be "blur", "pixelate", "zoom", "swirl", "noise", "scatter", or "random"`);
      if (question.duration !== undefined) {
        if (typeof question.duration !== 'number' || (question.duration as number) <= 0)
          errors.push(`Game "${gameRef}", question ${index}: "duration" must be a positive number`);
      }
      break;
  }

  return errors;
}

validateConfig();
