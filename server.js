const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve static files from the 'music' directory
app.use('/music', express.static(path.join(__dirname, 'music')));

// Serve static files from the 'images' directory
app.use('/images', express.static(path.join(__dirname, 'images')));

// Load game configuration
function loadConfig() {
    const configPath = path.join(__dirname, 'config.json');
    try {
        const data = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Failed to load config:', err);
        return null;
    }
}

// Endpoint to get the list of subfolders in the 'music' directory
app.get('/api/music-subfolders', (req, res) => {
    const musicDir = path.join(__dirname, 'music');
    fs.readdir(musicDir, { withFileTypes: true }, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to read music directory' });
        }
        const subfolders = files.filter(dirent => dirent.isDirectory()).map(dirent => dirent.name);
        res.json(subfolders);
    });
});

// Get full config with dynamic game4 questions
app.get('/api/config', (req, res) => {
    const configPath = path.join(__dirname, 'config.json');
    fs.readFile(configPath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to read config file' });
        }
        const config = JSON.parse(data);
        
        // Dynamically add game4 questions from images directory
        const imagesDir = path.join(__dirname, 'images');
        fs.readdir(imagesDir, (err, files) => {
            if (err) {
                console.warn('No images directory found');
                return res.json(config);
            }
            
            let questions = files
                .filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file))
                .map(file => {
                    const answer = path.basename(file, path.extname(file)).replace(/^Beispiel_/, '');
                    return {
                        image: `/images/${file}`,
                        answer: answer,
                        isExample: file.startsWith('Beispiel_')
                    };
                });
            
            // Ensure the example question is first
            const exampleQuestion = questions.find(q => q.isExample);
            questions = questions.filter(q => !q.isExample);
            questions.sort(() => Math.random() - 0.5);
            if (exampleQuestion) {
                questions.unshift(exampleQuestion);
            }
            
            // Add dynamic questions to game4 config
            if (config.games && config.games.game4) {
                config.games.game4.questions = questions;
            }
            
            res.json(config);
        });
    });
});

// Get game order
app.get('/api/game-order', (req, res) => {
    const config = loadConfig();
    if (!config) {
        return res.status(500).json({ error: 'Failed to load config' });
    }
    res.json({ 
        gameOrder: config.gameOrder || [],
        totalGames: config.gameOrder ? config.gameOrder.length : 0
    });
});

// Get specific game config by index
app.get('/api/game/:index', (req, res) => {
    const configPath = path.join(__dirname, 'config.json');
    fs.readFile(configPath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to load config' });
        }
        
        const config = JSON.parse(data);
        const index = parseInt(req.params.index);
        
        if (isNaN(index) || index < 0 || !config.gameOrder || index >= config.gameOrder.length) {
            return res.status(404).json({ error: 'Game not found' });
        }
        
        const gameId = config.gameOrder[index];
        const gameConfig = config.games[gameId];
        
        if (!gameConfig) {
            return res.status(404).json({ error: 'Game configuration not found' });
        }
        
        // If it's game4 (image game), add dynamic questions from images directory
        if (gameConfig.type === 'image') {
            const imagesDir = path.join(__dirname, 'images');
            fs.readdir(imagesDir, (err, files) => {
                if (err) {
                    // No images directory, send config without questions
                    return res.json({
                        gameId: gameId,
                        config: gameConfig,
                        currentIndex: index,
                        totalGames: config.gameOrder.length
                    });
                }
                
                let questions = files
                    .filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file))
                    .map(file => {
                        const answer = path.basename(file, path.extname(file)).replace(/^Beispiel_/, '');
                        return {
                            image: `/images/${file}`,
                            answer: answer,
                            isExample: file.startsWith('Beispiel_')
                        };
                    });
                
                // Ensure the example question is first
                const exampleQuestion = questions.find(q => q.isExample);
                questions = questions.filter(q => !q.isExample);
                questions.sort(() => Math.random() - 0.5);
                if (exampleQuestion) {
                    questions.unshift(exampleQuestion);
                }
                
                gameConfig.questions = questions;
                
                res.json({
                    gameId: gameId,
                    config: gameConfig,
                    currentIndex: index,
                    totalGames: config.gameOrder.length
                });
            });
        } else {
            // For other game types, return config as is
            res.json({
                gameId: gameId,
                config: gameConfig,
                currentIndex: index,
                totalGames: config.gameOrder.length
            });
        }
    });
});

// Dynamic game route - serves games based on index
app.get('/game', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'game-loader.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Game configuration loaded with ${loadConfig()?.gameOrder?.length || 0} games`);
});
