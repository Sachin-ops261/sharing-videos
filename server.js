require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/videos', require('./routes/videoRoutes'));

app.get('/api/health', (req, res) => {
    res.json({ message: "Server running smoothly!" });
});

// Create explicit server layer to configure timeout profiles
const server = http.createServer(app);

// Keep connection open for up to 20 minutes for massive files
server.timeout = 1200000; 
server.keepAliveTimeout = 60000;

server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});