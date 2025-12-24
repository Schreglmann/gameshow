#!/usr/bin/env node

/**
 * Interactive Config Generator
 * Helps create a config.json file interactively
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const GAME_TYPES = {
    '1': { type: 'quiz', name: 'Quiz - Standard Q&A' },
    '2': { type: 'guessing', name: 'Guessing - Number guessing' },
    '3': { type: 'buzzer', name: 'Buzzer - Fast-paced quiz' },
    '4': { type: 'music', name: 'Music - Music recognition' },
    '5': { type: 'image', name: 'Image - Picture quiz' },
    '6': { type: 'oddoneout', name: 'Odd One Out - Find the fake' },
    '7': { type: 'factorfake', name: 'Fact or Fake - True or false' }
};

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

function createQuestionTemplate(gameType) {
    switch (gameType) {
        case 'quiz':
        case 'buzzer':
            return { question: "Your question here", answer: "Your answer here" };
        case 'guessing':
            return { question: "Your question here", answer: 100 };
        case 'oddoneout':
            return {
                Frage: "Your question here",
                trueStatements: ["True statement 1", "True statement 2", "True statement 3"],
                wrongStatement: "Wrong statement",
                answer: "Explanation"
            };
        case 'factorfake':
            return {
                statement: "Your statement here",
                isFact: true,
                description: "Explanation"
            };
        default:
            return {};
    }
}

async function generateConfig() {
    console.log('🎮 Gameshow Config Generator\n');
    console.log('This tool will help you create a config.json file interactively.\n');

    const config = {
        gameOrder: [],
        games: {}
    };

    // Ask how many games
    const numGamesStr = await question('How many games do you want in your gameshow? ');
    const numGames = parseInt(numGamesStr) || 3;

    console.log(`\n📝 Creating ${numGames} games...\n`);

    // Create each game
    for (let i = 0; i < numGames; i++) {
        console.log(`\n--- Game ${i + 1} of ${numGames} ---`);

        // Game ID
        const defaultId = `game${i + 1}`;
        const gameId = await question(`Game ID (default: ${defaultId}): `) || defaultId;

        // Game type
        console.log('\nAvailable game types:');
        Object.entries(GAME_TYPES).forEach(([key, value]) => {
            console.log(`  ${key}. ${value.name}`);
        });

        let gameTypeChoice = await question('\nSelect game type (1-7): ');
        while (!GAME_TYPES[gameTypeChoice]) {
            console.log('Invalid choice. Please select 1-7.');
            gameTypeChoice = await question('Select game type (1-7): ');
        }

        const gameType = GAME_TYPES[gameTypeChoice].type;

        // Game title
        const defaultTitle = `${GAME_TYPES[gameTypeChoice].name.split(' - ')[0]} ${i + 1}`;
        const gameTitle = await question(`Game title (default: ${defaultTitle}): `) || defaultTitle;

        // Number of questions
        let numQuestions = 3;
        if (['quiz', 'guessing', 'buzzer', 'oddoneout', 'factorfake'].includes(gameType)) {
            const numQuestionsStr = await question('How many questions? (default: 3): ');
            numQuestions = parseInt(numQuestionsStr) || 3;
        }

        // Create game config
        const gameConfig = {
            type: gameType,
            title: gameTitle
        };

        // Add questions for types that need them
        if (['quiz', 'guessing', 'buzzer', 'oddoneout', 'factorfake'].includes(gameType)) {
            gameConfig.questions = [];
            // Add example question
            const exampleQuestion = createQuestionTemplate(gameType);
            if (gameType === 'quiz' || gameType === 'buzzer') {
                exampleQuestion.question = "Example question";
                exampleQuestion.answer = "Example answer";
            } else if (gameType === 'guessing') {
                exampleQuestion.question = "Example question";
                exampleQuestion.answer = 0;
            }
            gameConfig.questions.push(exampleQuestion);

            // Add regular questions
            for (let j = 0; j < numQuestions; j++) {
                gameConfig.questions.push(createQuestionTemplate(gameType));
            }
        }

        config.games[gameId] = gameConfig;
        config.gameOrder.push(gameId);

        console.log(`✅ Game "${gameId}" added!`);
    }

    // Save config
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
    console.log('  3. Run: npm start');
    console.log('\n🎉 Happy gaming!\n');

    rl.close();
}

// Run generator
generateConfig().catch(err => {
    console.error('Error:', err);
    rl.close();
    process.exit(1);
});
