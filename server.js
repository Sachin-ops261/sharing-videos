require('dotenv').config();
const express = require('express');
const path = require('path');
const AWS = require('aws-sdk');
const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

//middleware to parse incoming json data
app.use(express.json());

//serve static frontend files from your "public" directory 
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/videos', require('./routes/videoRoutes'));

//configure connection to your backblaze b2 bucket using s3 compatibility mode
const s3 = new AWS.S3({
    endpoint: process.env.B2_ENDPOINT,
    accessKeyId: process.env.B2_ACCESS_KEY_ID,
    secretAccessKey: process.env.B2_SECRET_ACCESS_KEY,
    signatureVersion: 'v4'  // required for secure presigned links 
});

//test backblaze connection instantly when server starts
s3.listObjectsV2({ Bucket: process.env.B2_BUCKET_NAME, MaxKeys: 1 }, (err, data) => {
    if (err) {
        console.error('❌ Error connecting to Backblaze B2:', err.message);
    } else {
        console.log('✅ Successfully connected to Backblaze B2 Cloud Storage!');
    }
});

// Basic route to verify server is active
app.get('/api/health', (req, res) => {
    res.json({ message: "Server is up and running smoothly!" });
});

// Start listening for connections
app.listen(PORT, () => {
    console.log(`🚀 Server is flying high on http://localhost:${PORT}`);
});