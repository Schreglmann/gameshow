const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve static files from the 'music' directory
app.use('/music', express.static(path.join(__dirname, 'music')));

// Serve game1.html
app.get('/game1', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game1.html'));
});

// Serve game2.html
app.get('/game2', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game2.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
