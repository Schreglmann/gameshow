#!/usr/bin/env node

/**
 * Config Validator
 * Validates the config.json file for the gameshow
 */

const fs = require('fs');
const path = require('path');

const VALID_GAME_TYPES = ['quiz', 'guessing', 'buzzer', 'music', 'image', 'oddoneout', 'factorfake'];

function validateConfig() {
    const configPath = path.join(__dirname, 'config.json');
    
    console.log('🔍 Validating config.json...\n');
    
    // Check if config.json exists
    if (!fs.existsSync(configPath)) {
        console.error('❌ Error: config.json not found!');
        console.log('💡 Tip: Copy config.template.json to config.json to get started.');
        process.exit(1);
    }
    
    // Read and parse config
    let config;
    try {
        const data = fs.readFileSync(configPath, 'utf8');
        config = JSON.parse(data);
    } catch (err) {
        console.error('❌ Error: Invalid JSON in config.json');
        console.error(err.message);
        process.exit(1);
    }
    
    let errors = [];
    let warnings = [];
    
    // Validate gameOrder
    if (!config.gameOrder) {
        errors.push('Missing "gameOrder" array');
    } else if (!Array.isArray(config.gameOrder)) {
        errors.push('"gameOrder" must be an array');
    } else if (config.gameOrder.length === 0) {
        warnings.push('gameOrder is empty - no games will be played');
    }
    
    // Validate games object
    if (!config.games) {
        errors.push('Missing "games" object');
    } else if (typeof config.games !== 'object') {
        errors.push('"games" must be an object');
    }
    
    // Cross-check gameOrder with games
    if (config.gameOrder && config.games) {
        config.gameOrder.forEach((gameId, index) => {
            if (!config.games[gameId]) {
                errors.push(`Game "${gameId}" in gameOrder[${index}] not found in games object`);
            } else {
                // Validate individual game
                const game = config.games[gameId];
                const gameErrors = validateGame(gameId, game);
                errors.push(...gameErrors);
            }
        });
    }
    
    // Check for unused games
    if (config.games && config.gameOrder) {
        const usedGames = new Set(config.gameOrder);
        Object.keys(config.games).forEach(gameId => {
            if (!usedGames.has(gameId)) {
                warnings.push(`Game "${gameId}" is defined but not used in gameOrder`);
            }
        });
    }
    
    // Display results
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

function validateGame(gameId, game) {
    const errors = [];
    
    // Check type
    if (!game.type) {
        errors.push(`Game "${gameId}": missing "type" field`);
    } else if (!VALID_GAME_TYPES.includes(game.type)) {
        errors.push(`Game "${gameId}": invalid type "${game.type}". Valid types: ${VALID_GAME_TYPES.join(', ')}`);
    }
    
    // Check title
    if (!game.title) {
        errors.push(`Game "${gameId}": missing "title" field`);
    }
    
    // Check questions for types that need them
    const typesNeedingQuestions = ['quiz', 'guessing', 'buzzer', 'oddoneout', 'factorfake'];
    if (game.type && typesNeedingQuestions.includes(game.type)) {
        if (!game.questions) {
            errors.push(`Game "${gameId}": missing "questions" array`);
        } else if (!Array.isArray(game.questions)) {
            errors.push(`Game "${gameId}": "questions" must be an array`);
        } else if (game.questions.length === 0) {
            errors.push(`Game "${gameId}": "questions" array is empty`);
        } else {
            // Validate question structure
            game.questions.forEach((q, idx) => {
                const qErrors = validateQuestion(gameId, game.type, q, idx);
                errors.push(...qErrors);
            });
        }
    }
    
    return errors;
}

function validateQuestion(gameId, gameType, question, index) {
    const errors = [];
    
    switch (gameType) {
        case 'quiz':
        case 'buzzer':
            if (!question.question) {
                errors.push(`Game "${gameId}", question ${index}: missing "question" field`);
            }
            if (!question.answer) {
                errors.push(`Game "${gameId}", question ${index}: missing "answer" field`);
            }
            break;
            
        case 'guessing':
            if (!question.question) {
                errors.push(`Game "${gameId}", question ${index}: missing "question" field`);
            }
            if (typeof question.answer !== 'number') {
                errors.push(`Game "${gameId}", question ${index}: "answer" must be a number`);
            }
            break;
            
        case 'oddoneout':
            if (!question.Frage) {
                errors.push(`Game "${gameId}", question ${index}: missing "Frage" field`);
            }
            if (!Array.isArray(question.trueStatements) || question.trueStatements.length === 0) {
                errors.push(`Game "${gameId}", question ${index}: missing or empty "trueStatements" array`);
            }
            if (!question.wrongStatement) {
                errors.push(`Game "${gameId}", question ${index}: missing "wrongStatement" field`);
            }
            break;
            
        case 'factorfake':
            if (!question.statement) {
                errors.push(`Game "${gameId}", question ${index}: missing "statement" field`);
            }
            if (typeof question.isFact !== 'boolean') {
                errors.push(`Game "${gameId}", question ${index}: "isFact" must be true or false`);
            }
            break;
    }
    
    return errors;
}

// Run validator
validateConfig();
