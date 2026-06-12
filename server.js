require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Link our upgraded v3 video routes
app.use('/api/videos', require('./routes/videoRoutes'));

const endpointUrl = process.env.B2_ENDPOINT || '';
const regionMatch = endpointUrl.match(/s3\.([a-z0-9\-]+)\.backblazeb2\.com/);
const detectedRegion = regionMatch ? regionMatch[1] : 'us-east-005';

// Initialize the modern v3 S3 Client for the startup sanity check
const s3Client = new S3Client({
    endpoint: `https://${endpointUrl}`,
    credentials: {
        accessKeyId: process.env.B2_ACCESS_KEY_ID,
        secretAccessKey: process.env.B2_SECRET_ACCESS_KEY,
    },
    region: detectedRegion,
    forcePathStyle: true
});

// Run a quick connection test on boot
async function testCloudConnection() {
    try {
        const command = new ListObjectsV2Command({
            Bucket: process.env.B2_BUCKET_NAME,
            MaxKeys: 1
        });
        await s3Client.send(command);
        console.log('✅ Successfully connected to Backblaze B2 Cloud Storage via SDK v3!');
    } catch (err) {
        console.error('❌ Error connecting to Backblaze B2:', err.message);
    }
}
testCloudConnection();

app.get('/api/health', (req, res) => {
    res.json({ message: "Server running smoothly!" });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});