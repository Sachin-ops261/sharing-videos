const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { S3Client, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const endpointUrl = process.env.B2_ENDPOINT || '';
const regionMatch = endpointUrl.match(/s3\.([a-z0-9\-]+)\.backblazeb2\.com/);
const detectedRegion = regionMatch ? regionMatch[1] : 'us-east-005';

const s3Client = new S3Client({
    endpoint: `https://${endpointUrl}`,
    credentials: {
        accessKeyId: process.env.B2_ACCESS_KEY_ID,
        secretAccessKey: process.env.B2_SECRET_ACCESS_KEY,
    },
    region: detectedRegion,
    forcePathStyle: true
});

/**
 * STREAM UPLOAD ROUTE: Receives data from browser and instantly pipes it to Backblaze
 */
router.post('/upload-stream', async (req, res) => {
    const filename = req.headers['x-filename'];
    if (!filename) {
        return res.status(400).json({ error: 'Missing X-Filename header' });
    }

    const uniqueKey = `${Date.now()}-${filename}`;

    try {
        // Automatically manages multi-part chunk streams without eating RAM or Disk space
        const parallelUpload = new Upload({
            client: s3Client,
            params: {
                Bucket: process.env.B2_BUCKET_NAME,
                Key: uniqueKey,
                Body: req // The raw incoming request stream
            },
            queueSize: 4,
            partSize: 1024 * 1024 * 5 // 5MB chunks
        });

        await parallelUpload.done();

        // Save reference info directly to Postgres
        await pool.query(
            'INSERT INTO videos (filename, b2_key) VALUES ($1, $2)',
            [filename, uniqueKey]
        );

        res.json({ message: 'Video uploaded and saved successfully!' });
    } catch (err) {
        console.error('Streaming upload failed:', err);
        res.status(500).json({ error: 'Streaming upload failed' });
    }
});

/**
 * GET ROUTE: List all videos with secure download URLs
 */
router.get('/list', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM videos ORDER BY uploaded_at DESC');
        
        const videoList = await Promise.all(result.rows.map(async (video) => {
            const command = new GetObjectCommand({
                Bucket: process.env.B2_BUCKET_NAME,
                Key: video.b2_key
            });
            const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 86400 });

            return {
                id: video.id,
                filename: video.filename,
                downloadUrl,
                uploadedAt: video.uploaded_at
            };
        }));

        res.json(videoList);
    } catch (err) {
        console.error('Error listing videos:', err);
        res.status(500).json({ error: 'Failed to fetch video list' });
    }
});

/**
 * DELETE ROUTE
 */
router.delete('/:id', async (req, res) => {
    try {
        const dbResult = await pool.query('SELECT b2_key FROM videos WHERE id = $1', [req.params.id]);
        if (dbResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });

        const command = new DeleteObjectCommand({
            Bucket: process.env.B2_BUCKET_NAME,
            Key: dbResult.rows[0].b2_key
        });
        await s3Client.send(command);

        await pool.query('DELETE FROM videos WHERE id = $1', [req.params.id]);
        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Deletion failed' });
    }
});

module.exports = router;