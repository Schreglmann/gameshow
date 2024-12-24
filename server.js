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

// Update config endpoint to include game6 questions
app.get('/api/config', (req, res) => {
    const configPath = path.join(__dirname, 'config.json');
    fs.readFile(configPath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to read config file' });
        }
        const config = JSON.parse(data);
        const imagesDir = path.join(__dirname, 'images');
        fs.readdir(imagesDir, (err, files) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to read images directory' });
            }
            config.game6 = {
                questions: files.map(file => {
                    const answer = path.basename(file, path.extname(file)).replace(/^Beispiel_/, '');
                    return {
                        image: `/images/${file}`,
                        answer: answer,
                        isExample: file.startsWith('Beispiel_') // Mark the image with prefix "Beispiel_" as an example
                    };
                })
            };
            res.json(config);
        });
    });
});

// Serve game1.html
app.get('/game1', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'game1.html'));
});

// Serve game2.html
app.get('/game2', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'game2.html'));
});

// Serve game3.html
app.get('/game3', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'game3.html'));
});

// Serve game4.html
app.get('/game4', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'game4.html'));
});

// Serve game5.html
app.get('/game5', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'game5.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
