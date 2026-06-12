const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
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

// 1. START CHUNKED SESSION
router.post('/start-upload', async (req, res) => {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'Filename required' });

    const uniqueKey = `${Date.now()}-${filename}`;

    try {
        const command = new CreateMultipartUploadCommand({
            Bucket: process.env.B2_BUCKET_NAME,
            Key: uniqueKey
        });
        const response = await s3Client.send(command);

        res.json({
            uploadId: response.UploadId,
            b2Key: uniqueKey
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to initialize session' });
    }
});

// 2. RECEIVE AND PUSH SINGLE CHUNK (Keeps RAM clean)
router.post('/upload-part', express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
    const { uploadId, b2Key, partNumber } = req.query;

    try {
        const command = new UploadPartCommand({
            Bucket: process.env.B2_BUCKET_NAME,
            Key: b2Key,
            UploadId: uploadId,
            PartNumber: parseInt(partNumber),
            Body: req.body
        });

        const response = await s3Client.send(command);
        res.json({ ETag: response.ETag });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Chunk transfer failed' });
    }
});

// 3. FINAL ASSEMBLY & DATABASE INDEXING
router.post('/complete-upload', async (req, res) => {
    const { uploadId, b2Key, filename, parts } = req.body;

    try {
        const command = new CompleteMultipartUploadCommand({
            Bucket: process.env.B2_BUCKET_NAME,
            Key: b2Key,
            UploadId: uploadId,
            MultipartUpload: { Parts: parts }
        });
        await s3Client.send(command);

        await pool.query(
            'INSERT INTO videos (filename, b2_key) VALUES ($1, $2)',
            [filename, b2Key]
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Final assembly failed' });
    }
});

// 4. GET VIDEOS LIST
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
        res.status(500).json({ error: 'Failed to fetch list' });
    }
});

// 5. DELETE VIDEO
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