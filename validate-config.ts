#!/usr/bin/env tsx

/**
 * Config Validator
 * Validates the config.json file for the gameshow
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { GameType, AppConfig, GameConfig } from './src/types/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_GAME_TYPES: GameType[] = [
  'simple-quiz',
  'guessing-game',
  'final-quiz',
  'audio-guess',
  'image-game',
  'four-statements',
  'fact-or-fake',
  'quizjagd',
];

function validateConfig(): void {
  const configPath = path.join(__dirname, 'config.json');

  console.log('🔍 Validating config.json...\n');

  if (!fs.existsSync(configPath)) {
    console.error('❌ Error: config.json not found!');
    console.log('💡 Tip: Copy config.template.json to config.json to get started.');
    process.exit(1);
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

  if (!config.gameOrder) {
    errors.push('Missing "gameOrder" array');
  } else if (!Array.isArray(config.gameOrder)) {
    errors.push('"gameOrder" must be an array');
  } else if (config.gameOrder.length === 0) {
    warnings.push('gameOrder is empty - no games will be played');
  }

  if (!config.games) {
    errors.push('Missing "games" object');
  } else if (typeof config.games !== 'object') {
    errors.push('"games" must be an object');
  }

  if (config.gameOrder && config.games) {
    config.gameOrder.forEach((gameId, index) => {
      if (!config.games[gameId]) {
        errors.push(`Game "${gameId}" in gameOrder[${index}] not found in games object`);
      } else {
        const game = config.games[gameId];
        const gameErrors = validateGame(gameId, game);
        errors.push(...gameErrors);
      }
    });
  }

  if (config.games && config.gameOrder) {
    const usedGames = new Set(config.gameOrder);
    Object.keys(config.games).forEach(gameId => {
      if (!usedGames.has(gameId)) {
        warnings.push(`Game "${gameId}" is defined but not used in gameOrder`);
      }
    });
  }

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

  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ Configuration is valid!');
    console.log(`📊 Games configured: ${config.gameOrder.length}`);
    console.log(`🎮 Game order: ${config.gameOrder.join(' → ')}\n`);
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

function validateGame(gameId: string, game: GameConfig): string[] {
  const errors: string[] = [];

  if (!game.type) {
    errors.push(`Game "${gameId}": missing "type" field`);
  } else if (!VALID_GAME_TYPES.includes(game.type)) {
    errors.push(
      `Game "${gameId}": invalid type "${game.type}". Valid types: ${VALID_GAME_TYPES.join(', ')}`
    );
  }

  if (!game.title) {
    errors.push(`Game "${gameId}": missing "title" field`);
  }

  const typesNeedingQuestions: GameType[] = [
    'simple-quiz',
    'guessing-game',
    'final-quiz',
    'four-statements',
    'fact-or-fake',
  ];

  if (game.type && typesNeedingQuestions.includes(game.type)) {
    if (!('questions' in game) || !game.questions) {
      errors.push(`Game "${gameId}": missing "questions" array`);
    } else if (!Array.isArray(game.questions)) {
      errors.push(`Game "${gameId}": "questions" must be an array`);
    } else if (game.questions.length === 0) {
      errors.push(`Game "${gameId}": "questions" array is empty`);
    } else {
      game.questions.forEach((q: Record<string, unknown>, idx: number) => {
        const qErrors = validateQuestion(gameId, game.type, q, idx);
        errors.push(...qErrors);
      });
    }
  }

  return errors;
}

function validateQuestion(
  gameId: string,
  gameType: GameType,
  question: Record<string, unknown>,
  index: number
): string[] {
  const errors: string[] = [];

  switch (gameType) {
    case 'simple-quiz':
    case 'final-quiz':
      if (!question.question) errors.push(`Game "${gameId}", question ${index}: missing "question"`);
      if (!question.answer) errors.push(`Game "${gameId}", question ${index}: missing "answer"`);
      break;

    case 'guessing-game':
      if (!question.question) errors.push(`Game "${gameId}", question ${index}: missing "question"`);
      if (typeof question.answer !== 'number')
        errors.push(`Game "${gameId}", question ${index}: "answer" must be a number`);
      break;

    case 'four-statements':
      if (!question.Frage) errors.push(`Game "${gameId}", question ${index}: missing "Frage"`);
      if (!Array.isArray(question.trueStatements) || question.trueStatements.length === 0)
        errors.push(`Game "${gameId}", question ${index}: missing or empty "trueStatements"`);
      if (!question.wrongStatement)
        errors.push(`Game "${gameId}", question ${index}: missing "wrongStatement"`);
      break;

    case 'fact-or-fake':
      if (!question.statement) errors.push(`Game "${gameId}", question ${index}: missing "statement"`);
      if (!['FAKT', 'FAKE'].includes(question.answer as string))
        errors.push(`Game "${gameId}", question ${index}: "answer" must be "FAKT" or "FAKE"`);
      break;
  }

  return errors;
}

validateConfig();
