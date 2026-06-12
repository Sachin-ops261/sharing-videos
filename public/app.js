document.addEventListener('DOMContentLoaded', () => {
    const videoFileInput = document.getElementById('videoFile');
    const uploadBtn = document.getElementById('uploadBtn');
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressStatus = document.getElementById('progressStatus');
    const videoListContainer = document.getElementById('videoList');

    const CHUNK_SIZE = 1024 * 1024 * 40; // High-Speed 40MB chunks

    fetchVideos();

    uploadBtn.addEventListener('click', async () => {
        const file = videoFileInput.files[0];
        if (!file) { alert('Select a file first!'); return; }

        uploadBtn.disabled = true;
        videoFileInput.disabled = true;
        progressContainer.style.display = 'block';

        try {
            // 1. Open upload session with Render
            const sessionRes = await fetch('/api/videos/start-upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.name })
            });
            if (!sessionRes.ok) throw new Error('Failed to initialize session');
            const { uploadId, b2Key } = await sessionRes.json();

            const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
            const uploadedParts = [];

            // 2. Loop and push high-speed chunks to our own domain
            for (let i = 0; i < totalChunks; i++) {
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, file.size);
                const chunk = file.slice(start, end);
                const partNumber = i + 1;

                progressStatus.innerText = `Processing speed-block ${partNumber} of ${totalChunks}...`;

                const uploadPartRes = await fetch(`/api/videos/upload-part?uploadId=${uploadId}&b2Key=${b2Key}&partNumber=${partNumber}`, {
                    method: 'POST',
                    body: chunk
                });

                if (!uploadPartRes.ok) throw new Error(`Block ${partNumber} disconnected`);
                const { ETag } = await uploadPartRes.json();
                uploadedParts.push({ ETag, PartNumber: partNumber });

                const percentComplete = Math.round(((i + 1) / totalChunks) * 100);
                progressBar.style.width = `${percentComplete}%`;
                progressBar.innerText = `${percentComplete}%`;
            }

            // 3. Finalize assembly
            progressStatus.innerText = 'Linking structural file layers...';
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
                throw new Error('Assembly processing failed');
            }

        } catch (err) {
            console.error(err);
            alert(`Upload Interrupted: ${err.message}`);
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
                    <div class="video-info"><div class="video-name">${video.filename}</div></div>
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
        } catch (err) { console.error(err); }
    }

    function resetUploadUI() {
        uploadBtn.disabled = false;
        videoFileInput.disabled = false;
        setTimeout(() => { progressContainer.style.display = 'none'; }, 5000);
    }
});