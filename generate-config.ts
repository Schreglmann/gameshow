#!/usr/bin/env tsx

/**
 * Interactive Config Generator
 * Helps create a config.json file interactively
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { GameType } from './src/types/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
        answer: 'FAKT',
        description: 'Explanation',
      };
    default:
      return {};
  }
}

async function generateConfig(): Promise<void> {
  console.log('🎮 Gameshow Config Generator\n');
  console.log('This tool will help you create a config.json file interactively.\n');

  const config: { gameOrder: string[]; games: Record<string, Record<string, unknown>> } = {
    gameOrder: [],
    games: {},
  };

  const numGamesStr = await question('How many games do you want in your gameshow? ');
  const numGames = parseInt(numGamesStr) || 3;

  console.log(`\n📝 Creating ${numGames} games...\n`);

  for (let i = 0; i < numGames; i++) {
    console.log(`\n--- Game ${i + 1} of ${numGames} ---`);

    const defaultId = `game${i + 1}`;
    const gameId = (await question(`Game ID (default: ${defaultId}): `)) || defaultId;

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

    const defaultTitle = `${GAME_TYPES[gameTypeChoice].name.split(' - ')[0]} ${i + 1}`;
    const gameTitle = (await question(`Game title (default: ${defaultTitle}): `)) || defaultTitle;

    let numQuestions = 3;
    const typesNeedingQuestions: GameType[] = [
      'simple-quiz',
      'guessing-game',
      'final-quiz',
      'four-statements',
      'fact-or-fake',
    ];
    if (typesNeedingQuestions.includes(gameType)) {
      const numQuestionsStr = await question('How many questions? (default: 3): ');
      numQuestions = parseInt(numQuestionsStr) || 3;
    }

    const gameConfig: Record<string, unknown> = {
      type: gameType,
      title: gameTitle,
    };

    if (typesNeedingQuestions.includes(gameType)) {
      const questions: Record<string, unknown>[] = [];
      // Add example question
      const exampleQ = createQuestionTemplate(gameType);
      if (gameType === 'simple-quiz' || gameType === 'final-quiz') {
        exampleQ.question = 'Example question';
        exampleQ.answer = 'Example answer';
      } else if (gameType === 'guessing-game') {
        exampleQ.question = 'Example question';
        exampleQ.answer = 0;
      }
      questions.push(exampleQ);

      for (let j = 0; j < numQuestions; j++) {
        questions.push(createQuestionTemplate(gameType));
      }
      gameConfig.questions = questions;
    }

    config.games[gameId] = gameConfig;
    config.gameOrder.push(gameId);

    console.log(`✅ Game "${gameId}" added!`);
  }

  const outputPath = path.join(__dirname, 'config.json');
  const configExists = fs.existsSync(outputPath);

  if (configExists) {
    const overwrite = await question('\n⚠️  config.json already exists. Overwrite? (yes/no): ');
    if (overwrite.toLowerCase() !== 'yes' && overwrite.toLowerCase() !== 'y') {
      const backupPath = path.join(__dirname, `config.backup.${Date.now()}.json`);
      fs.writeFileSync(backupPath, JSON.stringify(config, null, 2));
      console.log(`\n📁 Config saved to: ${backupPath}`);
      rl.close();
      return;
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
  console.log('\n✅ Config saved to config.json');
  console.log('\n📝 Next steps:');
  console.log('  1. Edit config.json to add your questions');
  console.log('  2. Run: npm run validate');
  console.log('  3. Run: npm run dev');
  console.log('\n🎉 Happy gaming!\n');

  rl.close();
}

generateConfig().catch(console.error);
