document.addEventListener('DOMContentLoaded', () => {
    const videoFileInput = document.getElementById('videoFile');
    const uploadBtn = document.getElementById('uploadBtn');
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressStatus = document.getElementById('progressStatus');
    const videoListContainer = document.getElementById('videoList');

    const CHUNK_SIZE = 1024 * 1024 * 6; // Stable 6MB S3-compliant blocks

    fetchVideos();

    uploadBtn.addEventListener('click', async () => {
        const file = videoFileInput.files[0];
        if (!file) {
            alert('Please select a video file first!');
            return;
        }

        uploadBtn.disabled = true;
        videoFileInput.disabled = true;
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressBar.innerText = '0%';
        progressStatus.innerText = 'Starting chunked pipeline connection...';

        try {
            // 1. Initialize our chunked multi-part session
            const sessionRes = await fetch('/api/videos/start-upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.name })
            });
            if (!sessionRes.ok) throw new Error('Could not open upload session');
            const { uploadId, b2Key } = await sessionRes.json();

            const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
            const uploadedParts = [];

            // 2. Loop through and push each individual fragment sequential-style
            for (let i = 0; i < totalChunks; i++) {
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, file.size);
                const chunk = file.slice(start, end);
                const partNumber = i + 1;

                progressStatus.innerText = `Uploading movie segment ${partNumber} of ${totalChunks}...`;

                const uploadPartRes = await fetch(`/api/videos/upload-part?uploadId=${uploadId}&b2Key=${b2Key}&partNumber=${partNumber}`, {
                    method: 'POST',
                    body: chunk
                });

                if (!uploadPartRes.ok) throw new Error(`Segment ${partNumber} connection lost`);
                const { ETag } = await uploadPartRes.json();

                uploadedParts.push({ ETag, PartNumber: partNumber });

                // Smoothly increment layout bar completion metrics
                const percentComplete = Math.round(((i + 1) / totalChunks) * 100);
                progressBar.style.width = `${percentComplete}%`;
                progressBar.innerText = `${percentComplete}%`;
            }

            // 3. Command final structural link assembly
            progressStatus.innerText = 'Assembling file layers inside bucket storage...';
            const completeRes = await fetch('/api/videos/complete-upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uploadId, b2Key, filename: file.name, parts: uploadedParts })
            });

            if (completeRes.ok) {
                progressStatus.innerText = '🎉 Movie successfully shared!';
                alert('Movie successfully shared!');
                videoFileInput.value = '';
                fetchVideos();
            } else {
                throw new Error('Storage assembly processing failed');
            }

        } catch (err) {
            console.error(err);
            alert(`Upload Blocked: ${err.message}`);
        } finally {
            resetUploadUI();
        }
    });

    async function fetchVideos() {
        try {
            const response = await fetch('/api/videos/list');
            const videos = await response.json();
            if (videos.length === 0) {
                videoListContainer.innerHTML = '<p class="loading-text">No shared videos available right now.</p>';
                return;
            }
            videoListContainer.innerHTML = '';
            videos.forEach(video => {
                const formattedDate = new Date(video.uploadedAt).toLocaleString();
                const videoItem = document.createElement('div');
                videoItem.className = 'video-item';
                videoItem.innerHTML = `
                    <div class="video-info">
                        <div class="video-name">${video.filename}</div>
                        <div class="video-date">Uploaded: ${formattedDate}</div>
                    </div>
                    <div class="video-actions">
                        <a href="${video.downloadUrl}" class="download-btn" download>Download</a>
                        <button class="delete-btn" data-id="${video.id}">Delete</button>
                    </div>
                `;
                videoListContainer.appendChild(videoItem);
            });

            document.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    if (confirm('Are you sure?')) {
                        await fetch(`/api/videos/${e.target.getAttribute('data-id')}`, { method: 'DELETE' });
                        fetchVideos();
                    }
                });
            });
        } catch (err) {
            console.error(err);
        }
    }

    function resetUploadUI() {
        uploadBtn.disabled = false;
        videoFileInput.disabled = false;
        setTimeout(() => { progressContainer.style.display = 'none'; }, 5000);
    }
});