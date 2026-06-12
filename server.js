require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { S3Client, ListObjectsV2Command, PutBucketCorsCommand } = require('@aws-sdk/client-s3');

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

// Initialize the modern v3 S3 Client
const s3Client = new S3Client({
    endpoint: `https://${endpointUrl}`,
    credentials: {
        accessKeyId: process.env.B2_ACCESS_KEY_ID,
        secretAccessKey: process.env.B2_SECRET_ACCESS_KEY,
    },
    region: detectedRegion,
    forcePathStyle: true
});

// AUTOMATED CURE: Programmatically force Backblaze to update its CORS rules
async function configureBucketCors() {
    try {
        console.log('⏳ Attempting to inject bulletproof CORS rules into Backblaze...');
        
        const corsCommand = new PutBucketCorsCommand({
            Bucket: process.env.B2_BUCKET_NAME,
            CORSConfiguration: {
                CORSRules: [
                    {
                        AllowedOrigins: ['*'], // Allows your local machine AND your Render live domain
                        AllowedMethods: ['PUT', 'POST', 'GET', 'HEAD', 'DELETE'],
                        AllowedHeaders: ['*'],
                        ExposeHeaders: ['ETag', 'x-amz-server-side-encryption', 'x-amz-request-id'],
                        MaxAgeSeconds: 3600
                    }
                ]
            }
        });

        await s3Client.send(corsCommand);
        console.log('🚀 ✅ SUCCESS: Backblaze CORS rules have been hard-coded into your bucket!');

        // Sanity connection check
        const listCommand = new ListObjectsV2Command({
            Bucket: process.env.B2_BUCKET_NAME,
            MaxKeys: 1
        });
        await s3Client.send(listCommand);
        console.log('✅ Connected to Backblaze storage successfully.');
    } catch (err) {
        console.error('❌ Failed to auto-configure Backblaze CORS:', err.message);
    }
}
configureBucketCors();

app.get('/api/health', (req, res) => {
    res.json({ message: "Server running smoothly!" });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});