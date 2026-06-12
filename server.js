require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors'); // 1. Import cors
const AWS = require('aws-sdk');
const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

// 2. Enable CORS so Render allows secure frontend/backend communication
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/videos', require('./routes/videoRoutes'));

const s3 = new AWS.S3({
    endpoint: process.env.B2_ENDPOINT,
    accessKeyId: process.env.B2_ACCESS_KEY_ID,
    secretAccessKey: process.env.B2_SECRET_ACCESS_KEY,
    signatureVersion: 'v4'
});

s3.listObjectsV2({ Bucket: process.env.B2_BUCKET_NAME, MaxKeys: 1 }, (err, data) => {
    if (err) console.error('❌ Error connecting to Backblaze B2:', err.message);
    else console.log('✅ Successfully connected to Backblaze B2 Cloud Storage!');
});

app.get('/api/health', (req, res) => {
    res.json({ message: "Server running smoothly!" });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});