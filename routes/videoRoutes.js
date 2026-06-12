const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
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
 * 1. POST ROUTE: Generate a clean presigned URL without pinning Content-Type headers
 */
router.post('/generate-upload-url', async (req, res) => {
    const { filename } = req.body;

    if (!filename) {
        return res.status(400).json({ error: 'Filename is required' });
    }

    const uniqueKey = `${Date.now()}-${filename}`;

    try {
        const command = new PutObjectCommand({
            Bucket: process.env.B2_BUCKET_NAME,
            Key: uniqueKey
            // We intentionally leave ContentType out of the signing payload here
            // to stop Backblaze from throwing signature/CORS mismatches on preflight
        });

        const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        
        res.json({
            uploadUrl,
            b2Key: uniqueKey
        });
    } catch (err) {
        console.error('Error generating presigned URL:', err);
        res.status(500).json({ error: 'Failed to generate upload link' });
    }
});

/**
 * 2. POST ROUTE: Save file metadata to PostgreSQL
 */
router.post('/save-metadata', async (req, res) => {
    const { filename, b2Key } = req.body;

    if (!filename || !b2Key) {
        return res.status(400).json({ error: 'Filename and b2Key are required' });
    }

    try {
        await pool.query(
            'INSERT INTO videos (filename, b2_key) VALUES ($1, $2)',
            [filename, b2Key]
        );
        res.json({ message: 'Video metadata saved successfully!' });
    } catch (err) {
        console.error('Error saving metadata:', err);
        res.status(500).json({ error: 'Database saving failed' });
    }
});

/**
 * 3. GET ROUTE: List all videos
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
 * 4. DELETE ROUTE: Delete video
 */
router.delete('/:id', async (req, res) => {
    const videoId = req.params.id;

    try {
        const dbResult = await pool.query('SELECT b2_key FROM videos WHERE id = $1', [videoId]);
        if (dbResult.rows.length === 0) {
            return res.status(404).json({ error: 'Video not found' });
        }

        const b2Key = dbResult.rows[0].b2_key;

        const command = new DeleteObjectCommand({
            Bucket: process.env.B2_BUCKET_NAME,
            Key: b2Key
        });
        await s3Client.send(command);

        await pool.query('DELETE FROM videos WHERE id = $1', [videoId]);
        res.json({ message: 'Video completely deleted!' });
    } catch (err) {
        console.error('Error deleting video:', err);
        res.status(500).json({ error: 'Failed to delete video' });
    }
});

module.exports = router;