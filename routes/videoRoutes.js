const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const AWS = require('aws-sdk');
const multer = require('multer');
const fs = require('fs');

// Use local temporary disk storage instead of system RAM
const upload = multer({ 
    dest: 'uploads/', // Files are safely chunked onto the hard drive temporarily
    limits: { fileSize: 4 * 1024 * 1024 * 1024 } // 4GB maximum safety guardrail
});

const endpointUrl = process.env.B2_ENDPOINT || '';
const regionMatch = endpointUrl.match(/s3\.([a-z0-9\-]+)\.backblazeb2\.com/);
const detectedRegion = regionMatch ? regionMatch[1] : 'us-east-005';

const s3 = new AWS.S3({
    endpoint: `https://${endpointUrl}`,
    accessKeyId: process.env.B2_ACCESS_KEY_ID,
    secretAccessKey: process.env.B2_SECRET_ACCESS_KEY,
    region: detectedRegion,
    signatureVersion: 'v4',
    s3ForcePathStyle: true
});

/**
 * 1. POST ROUTE: Receive file from frontend using disk storage streams
 */
router.post('/upload', upload.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const filename = req.file.originalname;
        const uniqueKey = `${Date.now()}-${filename}`;
        
        // Open a direct read stream from the temp disk location
        const fileStream = fs.createReadStream(req.file.path);

        const params = {
            Bucket: process.env.B2_BUCKET_NAME,
            Key: uniqueKey,
            Body: fileStream, // Stream raw file blocks directly to the cloud
            ContentType: req.file.mimetype
        };

        // Complete the cloud storage sync
        await s3.upload(params).promise();

        // Automatically clean up/delete the temporary disk file right after upload finishes
        fs.unlinkSync(req.file.path);

        // Save reference track string inside Neon PostgreSQL
        await pool.query(
            'INSERT INTO videos (filename, b2_key) VALUES ($1, $2)',
            [filename, uniqueKey]
        );

        res.json({ message: 'Video completely processed and saved!' });
    } catch (err) {
        console.error('Upload Error route fallback:', err);
        // Ensure cleanup occurs even if transmission breaks down midway
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: 'Server gateway transmission failed.' });
    }
});

/**
 * 2. GET ROUTE: List all videos with temporary download tokens
 */
router.get('/list', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM videos ORDER BY uploaded_at DESC');
        
        const videoList = await Promise.all(result.rows.map(async (video) => {
            const downloadUrl = await s3.getSignedUrlPromise('getObject', {
                Bucket: process.env.B2_BUCKET_NAME,
                Key: video.b2_key,
                Expires: 86400
            });

            return {
                id: video.id,
                filename: video.filename,
                downloadUrl,
                uploadedAt: video.uploaded_at
            };
        }));

        res.json(videoList);
    } catch (err) {
        console.error('Error fetching list:', err);
        res.status(500).json({ error: 'Failed to build directory list' });
    }
});

/**
 * 3. DELETE ROUTE: Purge item from bucket and database tracker row
 */
router.delete('/:id', async (req, res) => {
    const videoId = req.params.id;

    try {
        const dbResult = await pool.query('SELECT b2_key FROM videos WHERE id = $1', [videoId]);
        if (dbResult.rows.length === 0) {
            return res.status(404).json({ error: 'Video record not located' });
        }

        const b2Key = dbResult.rows[0].b2_key;

        await s3.deleteObject({
            Bucket: process.env.B2_BUCKET_NAME,
            Key: b2Key
        }).promise();

        await pool.query('DELETE FROM videos WHERE id = $1', [videoId]);
        res.json({ message: 'Video removed to preserve capacity.' });
    } catch (err) {
        console.error('Error deleting video context:', err);
        res.status(500).json({ error: 'Failed to drop video entry.' });
    }
});

module.exports = router;