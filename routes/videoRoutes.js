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

router.post('/upload-stream', async (req, res) => {
    // Read clean raw header elements
    const rawFilename = req.headers['x-filename'] || 'video.mp4';
    const filename = decodeURIComponent(rawFilename);
    const uniqueKey = `${Date.now()}-${filename}`;

    try {
        const parallelUpload = new Upload({
            client: s3Client,
            params: {
                Bucket: process.env.B2_BUCKET_NAME,
                Key: uniqueKey,
                Body: req // Pipe incoming request stream straight out to cloud bucket
            },
            queueSize: 4,
            partSize: 1024 * 1024 * 10 // 10MB chunks for optimized network routing
        });

        await parallelUpload.done();

        await pool.query(
            'INSERT INTO videos (filename, b2_key) VALUES ($1, $2)',
            [filename, uniqueKey]
        );

        res.json({ message: 'Success' });
    } catch (err) {
        console.error('Streaming upload failed:', err);
        res.status(500).json({ error: 'Streaming upload failed' });
    }
});

router.get('/list', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM videos ORDER BY uploaded_at DESC');
        const videoList = await Promise.all(result.rows.map(async (video) => {
            const command = new GetObjectCommand({ Bucket: process.env.B2_BUCKET_NAME, Key: video.b2_key });
            const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 86400 });
            return { id: video.id, filename: video.filename, downloadUrl, uploadedAt: video.uploaded_at };
        }));
        res.json(videoList);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch list' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const dbResult = await pool.query('SELECT b2_key FROM videos WHERE id = $1', [req.params.id]);
        if (dbResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });

        const command = new DeleteObjectCommand({ Bucket: process.env.B2_BUCKET_NAME, Key: dbResult.rows[0].b2_key });
        await s3Client.send(command);

        await pool.query('DELETE FROM videos WHERE id = $1', [req.params.id]);
        res.json({ message: 'Deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Deletion failed' });
    }
});

module.exports = router;