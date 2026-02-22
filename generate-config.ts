#!/usr/bin/env tsx

/**
 * Interactive Config Generator
 * Helps create game files in games/ and a config.json for a gameshow
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { GameType } from './src/types/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GAMES_DIR = path.join(__dirname, 'games');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

interface GameTypeOption {
  type: GameType;
  name: string;
}

const GAME_TYPES: Record<string, GameTypeOption> = {
  '1': { type: 'simple-quiz', name: 'Quiz - Standard Q&A' },
  '2': { type: 'guessing-game', name: 'Guessing - Number guessing' },
  '3': { type: 'final-quiz', name: 'Final Quiz - Buzzer with betting' },
  '4': { type: 'audio-guess', name: 'Audio - Music recognition' },
  '5': { type: 'image-game', name: 'Image - Picture quiz' },
  '6': { type: 'four-statements', name: 'Four Statements - Find the fake' },
  '7': { type: 'fact-or-fake', name: 'Fact or Fake - True or false' },
  '8': { type: 'quizjagd', name: 'Quizjagd - Difficulty betting quiz' },
};

function question(query: string): Promise<string> {
  return new Promise(resolve => rl.question(query, resolve));
}

function createQuestionTemplate(gameType: GameType): Record<string, unknown> {
  switch (gameType) {
    case 'simple-quiz':
    case 'final-quiz':
      return { question: 'Your question here', answer: 'Your answer here' };
    case 'guessing-game':
      return { question: 'Your question here', answer: 100 };
    case 'four-statements':
      return {
        Frage: 'Your question here',
        trueStatements: ['True statement 1', 'True statement 2', 'True statement 3'],
        wrongStatement: 'Wrong statement',
      };
    case 'fact-or-fake':
      return {
        statement: 'Your statement here',
        isFact: true,
        description: 'Explanation',
      };
    default:
      return {};
  }
}

function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[äöüß]/g, c => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c] || c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function generateConfig(): Promise<void> {
  console.log('🎮 Gameshow Config Generator\n');
  console.log('Games are stored as individual files in games/');
  console.log('config.json just selects which games to play.\n');

  fs.mkdirSync(GAMES_DIR, { recursive: true });

  // List existing games
  const existingFiles = fs.readdirSync(GAMES_DIR).filter(f => f.endsWith('.json'));
  if (existingFiles.length > 0) {
    console.log('📁 Existing game files:');
    for (const file of existingFiles) {
      const data = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, file), 'utf8'));
      const gameName = file.replace(/\.json$/, '');
      const hasInstances = 'instances' in data;
      if (hasInstances) {
        const instances = Object.keys(data.instances);
        console.log(`  ${gameName} (${data.type}) — instances: ${instances.join(', ')}`);
      } else {
        console.log(`  ${gameName} (${data.type})`);
      }
    }
    console.log('');
  }

  const mode = await question('What would you like to do?\n  1. Create a new game file\n  2. Build config.json (select games for a gameshow)\n  3. Both\nChoice (1/2/3): ');

  const gameOrder: string[] = [];

  if (mode === '1' || mode === '3') {
    await createGameFiles();
  }

  if (mode === '2' || mode === '3') {
    await buildConfigJson(gameOrder);
  }

  if (mode === '1') {
    console.log('\n📝 Next: Run this again and choose option 2 to build config.json');
  }

  rl.close();
}

async function createGameFiles(): Promise<void> {
  const numGamesStr = await question('\nHow many new game files to create? ');
  const numGames = parseInt(numGamesStr) || 1;

  for (let i = 0; i < numGames; i++) {
    console.log(`\n--- New Game ${i + 1} of ${numGames} ---`);

    const gameName = await question('Game name (kebab-case, e.g. "trump-oder-hitler"): ');
    const fileName = toKebabCase(gameName) || `game-${Date.now()}`;

    console.log('\nAvailable game types:');
    Object.entries(GAME_TYPES).forEach(([key, value]) => {
      console.log(`  ${key}. ${value.name}`);
    });

    let gameTypeChoice = await question('\nSelect game type (1-8): ');
    while (!GAME_TYPES[gameTypeChoice]) {
      console.log('Invalid choice. Please select 1-8.');
      gameTypeChoice = await question('Select game type (1-8): ');
    }

    const gameType = GAME_TYPES[gameTypeChoice].type;
    const gameTitle = (await question('Game title: ')) || fileName;

    const gameConfig: Record<string, unknown> = {
      type: gameType,
      title: gameTitle,
    };

    const typesNeedingQuestions: GameType[] = [
      'simple-quiz',
      'guessing-game',
      'final-quiz',
      'four-statements',
      'fact-or-fake',
    ];

    if (typesNeedingQuestions.includes(gameType)) {
      const numQuestionsStr = await question('How many template questions? (default: 3): ');
      const numQuestions = parseInt(numQuestionsStr) || 3;

      const questions: Record<string, unknown>[] = [];
      for (let j = 0; j < numQuestions; j++) {
        questions.push(createQuestionTemplate(gameType));
      }
      gameConfig.questions = questions;
    }

    const filePath = path.join(GAMES_DIR, `${fileName}.json`);
    if (fs.existsSync(filePath)) {
      const overwrite = await question(`⚠️  games/${fileName}.json already exists. Overwrite? (yes/no): `);
      if (overwrite.toLowerCase() !== 'yes' && overwrite.toLowerCase() !== 'y') {
        console.log('Skipped.');
        continue;
      }
    }

    fs.writeFileSync(filePath, JSON.stringify(gameConfig, null, 4));
    console.log(`✅ Created games/${fileName}.json`);
  }
}

async function buildConfigJson(gameOrder: string[]): Promise<void> {
  console.log('\n--- Build config.json ---');

  const gameshowId = await question('Gameshow ID (e.g. "gameshow4"): ');
  const gameshowName = await question('Gameshow name (e.g. "Gameshow 4"): ');

  console.log('\nEnter game references for gameOrder (one per line).');
  console.log('Format: "game-name" or "game-name/instance" for multi-instance games.');
  console.log('Enter empty line when done.\n');

  // List available games
  const existingFiles = fs.readdirSync(GAMES_DIR).filter(f => f.endsWith('.json'));
  console.log('Available games:');
  for (const file of existingFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, file), 'utf8'));
    const gameName = file.replace(/\.json$/, '');
    if ('instances' in data) {
      for (const inst of Object.keys(data.instances)) {
        console.log(`  ${gameName}/${inst}`);
      }
    } else {
      console.log(`  ${gameName}`);
    }
  }
  console.log('');

  while (true) {
    const ref = await question('Add game: ');
    if (!ref.trim()) break;
    gameOrder.push(ref.trim());
  }

  const outputPath = path.join(__dirname, 'config.json');
  let existingConfig: Record<string, unknown> = {};
  if (fs.existsSync(outputPath)) {
    try {
      existingConfig = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    } catch {
      // ignore parse errors, start fresh
    }
  }

  const existingGameshows = (existingConfig.gameshows as Record<string, unknown>) || {};
  existingGameshows[gameshowId || `gameshow-${Date.now()}`] = {
    name: gameshowName || gameshowId,
    gameOrder,
  };

  const config = {
    pointSystemEnabled: (existingConfig.pointSystemEnabled as boolean) ?? true,
    teamRandomizationEnabled: (existingConfig.teamRandomizationEnabled as boolean) ?? true,
    globalRules: (existingConfig.globalRules as string[]) || [
      'Es gibt mehrere Spiele.',
      'Bei jedem Spiel wird am Ende entschieden welches Team das Spiel gewonnen hat.',
      'Das erste Spiel ist 1 Punkt wert, das zweite 2 Punkte, etc.',
      'Das Team mit den meisten Punkten gewinnt am Ende.',
    ],
    activeGameshow: gameshowId || `gameshow-${Date.now()}`,
    gameshows: existingGameshows,
  };

  if (fs.existsSync(outputPath)) {
    const overwrite = await question('\n⚠️  config.json already exists. Overwrite? (yes/no): ');
    if (overwrite.toLowerCase() !== 'yes' && overwrite.toLowerCase() !== 'y') {
      const backupPath = path.join(__dirname, `config.backup.${Date.now()}.json`);
      fs.writeFileSync(backupPath, JSON.stringify(config, null, 2));
      console.log(`\n📁 Config saved to: ${backupPath}`);
      return;
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
  console.log('\n✅ Config saved to config.json');
  console.log(`🎮 Active gameshow: "${gameshowId}" with ${gameOrder.length} games`);
}

generateConfig().catch(console.error);
