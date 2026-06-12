const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const tus = require('tus-node-server');
const { S3Client, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const endpointUrl = process.env.B2_ENDPOINT || '';
const regionMatch = endpointUrl.match(/s3\.([a-z0-9\-]+)\.backblazeb2\.com/);
const detectedRegion = regionMatch ? regionMatch[1] : 'us-east-005';

// Initialize clean v3 S3 Client for downloads and deletions
const s3Client = new S3Client({
    endpoint: `https://${endpointUrl}`,
    credentials: {
        accessKeyId: process.env.B2_ACCESS_KEY_ID,
        secretAccessKey: process.env.B2_SECRET_ACCESS_KEY,
    },
    region: detectedRegion,
    forcePathStyle: true
});

// FIX: Configuration parameters must be defined inside the options block directly
const tusServer = new tus.Server({
    path: '/api/videos/upload-tus'
});

tusServer.datastore = new tus.S3Store({
    path: '/api/videos/upload-tus',
    bucket: process.env.B2_BUCKET_NAME,
    accessKeyId: process.env.B2_ACCESS_KEY_ID,
    secretAccessKey: process.env.B2_SECRET_ACCESS_KEY,
    endpoint: `https://${endpointUrl}`,
    region: detectedRegion,
    s3ForcePathStyle: true
});

// When a video completely finishes uploading its chunks, register it in PostgreSQL
tusServer.on(tus.EVENTS.EVENT_UPLOAD_COMPLETE, async (event) => {
    try {
        const filename = event.file.metadata.filename || 'shared-video.mp4';
        const b2Key = event.file.id;

        await pool.query(
            'INSERT INTO videos (filename, b2_key) VALUES ($1, $2)',
            [filename, b2Key]
        );
        console.log(`🚀 Video successfully registered: ${filename}`);
    } catch (err) {
        console.error('Failed to index complete video inside database:', err);
    }
});

// Pass all incoming chunk requests into the Tus protocol handler
router.all('/upload-tus*', (req, res) => {
    tusServer.handle(req, res);
});

/**
 * GET ROUTE: List all shared videos
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
        console.error(err);
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