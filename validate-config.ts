#!/usr/bin/env tsx

/**
 * Config Validator
 * Validates config.json and all referenced game files in games/
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { GameType, AppConfig, GameConfig, PointMode } from './src/types/config.js';
import { JOKER_CATALOG } from './src/data/jokers.js';
import { gameSupportsTeamCount, gameUsesCorrectAnswerTally, teamCountSupportLabel } from './src/data/gameTypeInfo.js';
import { ALL_POINT_MODES, DEFAULT_POINT_MODE } from './src/utils/pointMode.js';

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

const VALID_THEMES = ['galaxia', 'harry-potter', 'dnd', 'deepsea', 'enterprise', 'retro', 'minecraft', 'classical-music', 'modern-music', 'movie-quiz', 'atlas', 'atlas-light'];

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
  'colorguess',
  'ranking',
  'wer-kennt-mehr',
  'random-frame',
  'city-compass',
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

  // Validate rulesPresets (optional)
  const validPresetIds = new Set<string>();
  if (config.rulesPresets !== undefined) {
    if (!Array.isArray(config.rulesPresets)) {
      errors.push('"rulesPresets" must be an array');
    } else {
      config.rulesPresets.forEach((preset, idx) => {
        if (typeof preset !== 'object' || preset === null) {
          errors.push(`rulesPresets[${idx}]: must be an object`);
          return;
        }
        if (typeof preset.id !== 'string' || !preset.id.trim()) {
          errors.push(`rulesPresets[${idx}]: missing or empty "id" string`);
        } else if (validPresetIds.has(preset.id)) {
          errors.push(`rulesPresets[${idx}]: duplicate id "${preset.id}"`);
        } else {
          validPresetIds.add(preset.id);
        }
        if (typeof preset.name !== 'string' || !preset.name.trim()) {
          errors.push(`rulesPresets[${idx}]: missing or empty "name" string`);
        }
        if (!Array.isArray(preset.rules)) {
          errors.push(`rulesPresets[${idx}]: "rules" must be an array of strings`);
        } else if (preset.rules.some(r => typeof r !== 'string')) {
          errors.push(`rulesPresets[${idx}]: every entry in "rules" must be a string`);
        }
        // Team-count bands. Optional — an absent band falls back to `rules` at
        // runtime, so only a malformed one is an error. See specs/rules-presets.md.
        for (const band of ['rulesSolo', 'rulesMulti'] as const) {
          const value = (preset as Record<string, unknown>)[band];
          if (value === undefined) continue;
          if (!Array.isArray(value)) {
            errors.push(`rulesPresets[${idx}]: "${band}" must be an array of strings`);
          } else if (value.some(r => typeof r !== 'string')) {
            errors.push(`rulesPresets[${idx}]: every entry in "${band}" must be a string`);
          }
        }
      });
    }
  }

  // Validate jokerRules (optional) — generic joker explanation for the rules screen
  if (config.jokerRules !== undefined) {
    if (!Array.isArray(config.jokerRules)) {
      errors.push('"jokerRules" must be an array');
    } else if (config.jokerRules.some(r => typeof r !== 'string')) {
      errors.push('"jokerRules": every entry must be a string');
    }
  }

  // Validate jokerUsageScope (optional) — whether jokers refresh per game
  if (config.jokerUsageScope !== undefined && config.jokerUsageScope !== 'per-gameshow' && config.jokerUsageScope !== 'per-game') {
    errors.push('"jokerUsageScope" must be "per-gameshow" or "per-game"');
  }

  // Show title (optional, both levels). A blank value silently falls through to
  // the next level, which is easy to mistake for a broken field — warn.
  // See specs/show-title.md.
  if (config.showTitle !== undefined) {
    if (typeof config.showTitle !== 'string') {
      errors.push('"showTitle" must be a string');
    } else if (config.showTitle.trim() === '') {
      warnings.push('"showTitle" is empty — the default title "Game Show" is used');
    }
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

  // Validate each gameshow
  if (config.gameshows && typeof config.gameshows === 'object') {
    for (const [showKey, show] of Object.entries(config.gameshows)) {
      if (!show.name) {
        warnings.push(`Gameshow "${showKey}": missing "name" field`);
      }
      if (show.showTitle !== undefined) {
        if (typeof show.showTitle !== 'string') {
          errors.push(`Gameshow "${showKey}": "showTitle" must be a string`);
        } else if (show.showTitle.trim() === '') {
          warnings.push(
            `Gameshow "${showKey}": "showTitle" is empty — the global title is used instead`,
          );
        }
      }
      // Team count (0-4). Absent means the historic 2. See specs/team-count.md.
      let teamCount = 2;
      if (show.teamCount !== undefined) {
        if (typeof show.teamCount !== 'number' || !Number.isInteger(show.teamCount)
          || show.teamCount < 0 || show.teamCount > 4) {
          errors.push(`Gameshow "${showKey}": "teamCount" must be an integer between 0 and 4`);
        } else {
          teamCount = show.teamCount;
        }
      }
      // Point mode (optional). Absent means the historic positional scoring.
      // See specs/point-system.md.
      let pointMode = DEFAULT_POINT_MODE;
      if (show.pointMode !== undefined) {
        if (!ALL_POINT_MODES.includes(show.pointMode)) {
          errors.push(
            `Gameshow "${showKey}": "pointMode" must be one of ${ALL_POINT_MODES.map(m => `"${m}"`).join(', ')}`,
          );
        } else {
          pointMode = show.pointMode;
        }
      }

      if (config.pointSystemEnabled === false && teamCount > 0) {
        warnings.push(
          `Gameshow "${showKey}": teamCount=${teamCount} is overridden by the global ` +
          `"pointSystemEnabled": false — the show runs with no teams at all`,
        );
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

          let gameConfig: GameConfig;
          try {
            gameConfig = loadGameConfig(gameName, instanceName);
          } catch (err) {
            errors.push(`Gameshow "${showKey}" gameOrder[${index}] "${gameRef}": ${(err as Error).message}`);
            return;
          }

          const { errors: gameErrors, warnings: gameWarnings } = validateGame(gameRef, gameConfig, validPresetIds, teamCount, pointMode);
          errors.push(...gameErrors);
          warnings.push(...gameWarnings);
        });
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

function validateGame(
  gameRef: string,
  game: GameConfig,
  validPresetIds: Set<string>,
  /** Teams the referencing gameshow plays with (0-4). See specs/team-count.md. */
  teamCount = 2,
  /** How the referencing gameshow scores. See specs/point-system.md. */
  pointMode: PointMode = DEFAULT_POINT_MODE,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

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

  if (game.rulesPreset !== undefined) {
    if (typeof game.rulesPreset !== 'string') {
      errors.push(`Game "${gameRef}": "rulesPreset" must be a string`);
    } else if (!validPresetIds.has(game.rulesPreset)) {
      warnings.push(
        `Game "${gameRef}": "rulesPreset" references unknown preset id "${game.rulesPreset}". Falls back to inline rules at runtime.`
      );
    }
  }

  // `locked` is only valid on video-guess instances. Reject it on other game types so
  // a stale/misplaced field can't silently hide behind the TypeScript optional-property check.
  const gameRaw = game as Record<string, unknown>;
  if ('locked' in gameRaw) {
    if (game.type !== 'video-guess') {
      errors.push(`Game "${gameRef}": "locked" is only supported on video-guess instances`);
    } else if (typeof gameRaw.locked !== 'boolean') {
      errors.push(`Game "${gameRef}": "locked" must be a boolean`);
    }
  }

  // `disabled` (game/instance level) hides the game from the add-to-gameshow pickers but
  // never affects runtime resolution. Any game type may carry it. See specs/game-disable.md.
  if ('disabled' in gameRaw && typeof gameRaw.disabled !== 'boolean') {
    errors.push(`Game "${gameRef}": "disabled" must be a boolean`);
  }

  // `scoringMode` is only valid on wer-kennt-mehr, bet-quiz and guessing-game, each with
  // its own allowed values.
  if ('scoringMode' in gameRaw) {
    if (game.type === 'wer-kennt-mehr') {
      if (!['count', 'standard', 'count-penalty'].includes(gameRaw.scoringMode)) {
        errors.push(`Game "${gameRef}": "scoringMode" must be "count", "standard" or "count-penalty"`);
      }
    } else if (game.type === 'bet-quiz') {
      if (!['standard', 'transfer'].includes(gameRaw.scoringMode)) {
        errors.push(`Game "${gameRef}": "scoringMode" must be "standard" or "transfer"`);
      }
    } else if (game.type === 'guessing-game') {
      if (!['standard', 'auto'].includes(gameRaw.scoringMode)) {
        errors.push(`Game "${gameRef}": "scoringMode" must be "standard" or "auto"`);
      }
    } else {
      errors.push(`Game "${gameRef}": "scoringMode" is only supported on wer-kennt-mehr, bet-quiz and guessing-game games`);
    }
  }

  if ('reveal' in gameRaw) {
    if (game.type !== 'city-compass') {
      errors.push(`Game "${gameRef}": "reveal" is only supported on city-compass games`);
    } else if (!['all', 'progressive'].includes(gameRaw.reveal)) {
      errors.push(`Game "${gameRef}": "reveal" must be "all" or "progressive"`);
    }
  }

  if ('showDistances' in gameRaw) {
    if (game.type !== 'city-compass') {
      errors.push(`Game "${gameRef}": "showDistances" is only supported on city-compass games`);
    } else if (typeof gameRaw.showDistances !== 'boolean') {
      errors.push(`Game "${gameRef}": "showDistances" must be a boolean`);
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
    'colorguess',
    'ranking',
    'wer-kennt-mehr',
    'random-frame',
    'city-compass',
    // video-guess was missing: its questions array was never validated at all,
    // so a game with no `video` or no `answer` passed `npm run validate` and
    // only failed in front of the audience.
    'video-guess',
  ];

  // quizjagd stores `{ easy, medium, hard }` pools, not a flat `questions`
  // array, so it needs its own branch. Without one the whole file went
  // unchecked and a malformed pool white-screened the show at that round.
  if (game.type === 'quizjagd') {
    errors.push(...validateQuizjagd(gameRef, gameRaw, teamCount, warnings));
  }

  // A game whose mechanic can't be scored at this gameshow's team count still
  // plays — the server serves it `pointSystemEnabled: false` — so this is a
  // warning, never an error. See specs/team-count.md.
  if (game.type && VALID_GAME_TYPES.includes(game.type) && teamCount > 0) {
    const scoringMode = (game as { scoringMode?: string }).scoringMode;
    if (!gameSupportsTeamCount(game.type, teamCount, scoringMode)) {
      warnings.push(
        `Game "${gameRef}": type "${game.type}"${scoringMode ? ` (scoringMode "${scoringMode}")` : ''} ` +
        `cannot be scored with ${teamCount} team(s) — supports ${teamCountSupportLabel(game.type, scoringMode)}. ` +
        `It will be played WITHOUT scoring.`,
      );
    }
  }

  // `per-correct-answer` pays out the gamemaster's correct-answer tally, which the
  // inline-scored types never fill. They still play and still score — just by their
  // own mechanic — so this is a warning about the mismatch, not an error. Like the
  // team-count check above, it is a property of the pairing, not of the game file.
  if (game.type && VALID_GAME_TYPES.includes(game.type) && teamCount > 0
    && pointMode === 'per-correct-answer' && !gameUsesCorrectAnswerTally(game.type)) {
    warnings.push(
      `Game "${gameRef}": type "${game.type}" has no correct-answer tally, so the ` +
      `"per-correct-answer" point mode does not apply — it keeps its own scoring.`,
    );
  }

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

  return { errors, warnings };
}

/**
 * Validate a quizjagd game.
 *
 * quizjagd does not use a flat `questions` array — it holds three difficulty
 * pools, either as `{ easy, medium, hard }` or as a flat array tagged with
 * `difficulty: 3 | 5 | 7`. Neither shape was validated at all, so a malformed
 * file passed `npm run validate` and only failed live.
 *
 * Also enforces that the pools can actually SUPPLY the game: the first entry of
 * each pool is its Beispielfrage, so the playable count is `pool.length - 1`,
 * and the game needs `questionsPerTeam × 2` of them. Falling short used to hard-
 * lock the show on the difficulty screen with every button greyed out.
 */
export function validateQuizjagd(
  gameRef: string,
  gameRaw: Record<string, any>,
  teamCount = 2,
  supplyWarnings: string[] = [],
): string[] {
  const errors: string[] = [];
  const qs = gameRaw.questions;
  if (!qs) {
    errors.push(`Game "${gameRef}": missing "questions"`);
    return errors;
  }

  const DIFFICULTY_BY_POOL = { easy: 3, medium: 5, hard: 7 } as const;
  let pools: Record<'easy' | 'medium' | 'hard', Record<string, unknown>[]>;

  if (Array.isArray(qs)) {
    const flat = qs as Record<string, unknown>[];
    for (const [idx, q] of flat.entries()) {
      if (![3, 5, 7].includes(q.difficulty as number)) {
        errors.push(`Game "${gameRef}", question ${idx}: "difficulty" must be 3, 5 or 7`);
      }
    }
    pools = {
      easy: flat.filter(q => q.difficulty === 3),
      medium: flat.filter(q => q.difficulty === 5),
      hard: flat.filter(q => q.difficulty === 7),
    };
  } else if (typeof qs === 'object') {
    const struct = qs as Record<string, unknown>;
    for (const key of Object.keys(DIFFICULTY_BY_POOL)) {
      if (!Array.isArray(struct[key])) {
        errors.push(`Game "${gameRef}": "questions.${key}" must be an array`);
      }
    }
    if (errors.length > 0) return errors;
    pools = {
      easy: struct.easy as Record<string, unknown>[],
      medium: struct.medium as Record<string, unknown>[],
      hard: struct.hard as Record<string, unknown>[],
    };
  } else {
    errors.push(`Game "${gameRef}": "questions" must be an array or an object with easy/medium/hard pools`);
    return errors;
  }

  for (const [poolName, pool] of Object.entries(pools)) {
    if (pool.length === 0) {
      errors.push(`Game "${gameRef}": difficulty pool "${poolName}" is empty`);
      continue;
    }
    for (const [idx, q] of pool.entries()) {
      if (!q.question) errors.push(`Game "${gameRef}", ${poolName} question ${idx}: missing "question"`);
      if (!q.answer) errors.push(`Game "${gameRef}", ${poolName} question ${idx}: missing "answer"`);
    }
  }

  // Supply check. Each pool's first entry is the Beispielfrage and is not played.
  // How many questions are needed depends on the TEAM COUNT of the gameshow being
  // played (`questionsPerTeam × teamCount`), and one game file may be referenced
  // by gameshows with different counts — so this is reported by the caller as a
  // warning per referencing gameshow, not as a hard error here.
  // See specs/team-count.md.
  const questionsPerTeam = typeof gameRaw.questionsPerTeam === 'number' ? gameRaw.questionsPerTeam : 10;
  const playable = Object.values(pools).reduce((sum, pool) => sum + Math.max(0, pool.length - 1), 0);
  const needed = questionsPerTeam * teamCount;
  if (teamCount > 0 && playable < needed) {
    supplyWarnings.push(
      `Game "${gameRef}": only ${playable} playable question(s) across all difficulty pools, ` +
      `but questionsPerTeam=${questionsPerTeam} with ${teamCount} teams needs ${needed} ` +
      `(the first entry of each pool is its Beispielfrage and is not played)`,
    );
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

  const hasQuestionPrompt =
    Boolean(question.question) || Boolean(question.questionImage) || Boolean(question.questionAudio);

  switch (gameType) {
    case 'simple-quiz':
    case 'final-quiz':
      if (!hasQuestionPrompt)
        errors.push(`Game "${gameRef}", question ${index}: needs "question", "questionImage", or "questionAudio"`);
      if (!question.answer) errors.push(`Game "${gameRef}", question ${index}: missing "answer"`);
      break;

    case 'bet-quiz':
      if (!hasQuestionPrompt)
        errors.push(`Game "${gameRef}", question ${index}: needs "question", "questionImage", or "questionAudio"`);
      if (!question.answer) errors.push(`Game "${gameRef}", question ${index}: missing "answer"`);
      if (typeof question.category !== 'string' || !(question.category as string).trim())
        errors.push(`Game "${gameRef}", question ${index}: missing "category" (required for bet-quiz)`);
      break;

    case 'guessing-game':
      if (!hasQuestionPrompt)
        errors.push(`Game "${gameRef}", question ${index}: needs "question", "questionImage", or "questionAudio"`);
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

    case 'video-guess':
      if (!question.answer) errors.push(`Game "${gameRef}", question ${index}: missing "answer"`);
      if (!question.video) errors.push(`Game "${gameRef}", question ${index}: missing "video"`);
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

    case 'colorguess':
      if (!question.answer) errors.push(`Game "${gameRef}", question ${index}: missing "answer"`);
      if (!question.image) {
        errors.push(`Game "${gameRef}", question ${index}: missing "image"`);
      } else if (typeof question.image !== 'string' || !/\.(png|jpe?g|webp|svg)$/i.test(question.image)) {
        errors.push(`Game "${gameRef}", question ${index}: "image" must be a path ending in .png, .jpg, .jpeg, .webp, or .svg`);
      }
      break;

    case 'ranking': {
      if (typeof question.question !== 'string') {
        errors.push(`Game "${gameRef}", question ${index}: "question" must be a string`);
      }
      const hasRankingQuestion = typeof question.question === 'string' && (question.question as string).trim();
      const hasRankingItems = Array.isArray(question.items) && (question.items as unknown[]).some(a => typeof a === 'string' && (a as string).trim());
      // The question TEXT may be empty when items provide the on-screen prompt (the
      // items pool + its label stand in for the question), but a question needs one or the other.
      if (!hasRankingQuestion && !hasRankingItems)
        errors.push(`Game "${gameRef}", question ${index}: needs a non-empty "question" or "items"`);
      if (!Array.isArray(question.answers)) {
        errors.push(`Game "${gameRef}", question ${index}: "answers" must be an array`);
      } else if ((question.answers as unknown[]).some(a => typeof a !== 'string')) {
        errors.push(`Game "${gameRef}", question ${index}: every "answers" entry must be a string`);
      } else if ((question.answers as string[]).every(a => !a.trim())) {
        errors.push(`Game "${gameRef}", question ${index}: "answers" needs at least one non-empty entry`);
      }
      if (question.items !== undefined && (!Array.isArray(question.items) || (question.items as unknown[]).some(a => typeof a !== 'string'))) {
        errors.push(`Game "${gameRef}", question ${index}: "items" must be an array of strings`);
      }
      break;
    }

    case 'city-compass': {
      const checkCity = (city: unknown, label: string): void => {
        if (!city || typeof city !== 'object' || Array.isArray(city)) {
          errors.push(`Game "${gameRef}", question ${index}: ${label} must be an object with "name", "lat" and "lon"`);
          return;
        }
        const c = city as Record<string, unknown>;
        if (typeof c.name !== 'string' || !(c.name as string).trim())
          errors.push(`Game "${gameRef}", question ${index}: ${label} needs a non-empty "name"`);
        if (typeof c.lat !== 'number' || (c.lat as number) < -90 || (c.lat as number) > 90)
          errors.push(`Game "${gameRef}", question ${index}: ${label} needs a "lat" between -90 and 90`);
        if (typeof c.lon !== 'number' || (c.lon as number) < -180 || (c.lon as number) > 180)
          errors.push(`Game "${gameRef}", question ${index}: ${label} needs a "lon" between -180 and 180`);
      };

      checkCity(question.center, '"center"');
      if (!Array.isArray(question.neighbors)) {
        errors.push(`Game "${gameRef}", question ${index}: "neighbors" must be an array`);
      } else {
        // Two cities already pin a point down; three is the floor at which the
        // constellation reads as a shape rather than as a pair of directions.
        if ((question.neighbors as unknown[]).length < 3)
          errors.push(`Game "${gameRef}", question ${index}: needs at least 3 "neighbors"`);
        (question.neighbors as unknown[]).forEach((neighbor, i) => checkCity(neighbor, `neighbor ${i}`));
      }
      break;
    }

    case 'wer-kennt-mehr':
      if (!Boolean(question.question) && !Boolean(question.questionImage))
        errors.push(`Game "${gameRef}", question ${index}: needs "question" or "questionImage"`);
      // No answer check: this type has no correct answer. Teams name as many items
      // as they can and the host counts them, so `answer` / `answerList` are only an
      // optional host-side aid. A question with no examples is valid.
      break;

    case 'random-frame':
      if (!question.video) errors.push(`Game "${gameRef}", question ${index}: missing "video"`);
      if (!question.answer) errors.push(`Game "${gameRef}", question ${index}: missing "answer"`);
      if (question.frameStart !== undefined && (typeof question.frameStart !== 'number' || (question.frameStart as number) < 0))
        errors.push(`Game "${gameRef}", question ${index}: "frameStart" must be a non-negative number`);
      if (question.frameEnd !== undefined && (typeof question.frameEnd !== 'number' || (question.frameEnd as number) <= 0))
        errors.push(`Game "${gameRef}", question ${index}: "frameEnd" must be a positive number`);
      break;
  }

  return errors;
}

// Skipped under vitest so the individual validators can be unit-tested without
// running a full config validation (and its process.exit) on import. Mirrors the
// TEST_ENV guard in server/nas-reachability.ts.
if (!process.env.VITEST) validateConfig();
