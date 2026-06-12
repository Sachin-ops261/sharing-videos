document.addEventListener('DOMContentLoaded', () => {
    const videoFileInput = document.getElementById('videoFile');
    const uploadBtn = document.getElementById('uploadBtn');
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressStatus = document.getElementById('progressStatus');
    const videoListContainer = document.getElementById('videoList');

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
        progressStatus.innerText = 'Requesting direct-to-cloud authorization...';

        try {
            // Step 1: Request a clean presigned upload URL from our backend
            const urlResponse = await fetch('/api/videos/generate-upload-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.name })
            });

            if (!urlResponse.ok) throw new Error('Failed to fetch upload handshake');
            const { uploadUrl, b2Key } = await urlResponse.json();

            progressStatus.innerText = 'Uploading directly to Backblaze B2...';

            // Step 2: Push the file straight to Backblaze using XMLHttpRequest to monitor progress
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', uploadUrl, true);
            
            // NOTE: We intentionally do NOT set an explicit Content-Type request header here.
            // This prevents browser preflight configuration conflicts with the Backblaze S3 API.

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentComplete = Math.round((event.loaded / event.total) * 100);
                    progressBar.style.width = `${percentComplete}%`;
                    progressBar.innerText = `${percentComplete}%`;
                    
                    const uploadedGB = (event.loaded / (1024 * 1024 * 1024)).toFixed(2);
                    const totalGB = (event.total / (1024 * 1024 * 1024)).toFixed(2);
                    progressStatus.innerText = `Uploaded ${uploadedGB} GB of ${totalGB} GB directly to cloud storage...`;
                }
            };

            xhr.onload = async () => {
                if (xhr.status === 200 || xhr.status === 201) {
                    progressStatus.innerText = 'Finalizing metadata registration...';

                    // Step 3: Tell our database to index this new file reference key
                    const metaResponse = await fetch('/api/videos/save-metadata', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filename: file.name, b2Key })
                    });

                    if (metaResponse.ok) {
                        progressStatus.innerText = '🎉 Video successfully shared!';
                        alert('Video successfully shared!');
                        videoFileInput.value = '';
                        fetchVideos();
                    } else {
                        throw new Error('Cloud upload verified but database indexing rejected.');
                    }
                } else {
                    throw new Error(`Cloud bucket rejected binary stream with code: ${xhr.status}`);
                }
                resetUploadUI();
            };

            xhr.onerror = () => {
                alert('A direct network interruption occurred.');
                resetUploadUI();
            };

            xhr.send(file);

        } catch (err) {
            console.error(err);
            alert(`Upload Pipeline Blocked: ${err.message}`);
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
                    const id = e.target.getAttribute('data-id');
                    if (confirm('Are you sure you want to delete this video?')) {
                        await deleteVideo(id);
                    }
                });
            });

        } catch (err) {
            console.error(err);
            videoListContainer.innerHTML = '<p class="loading-text" style="color: #e11d48;">Error listing records.</p>';
        }
    }

    async function deleteVideo(id) {
        try {
            const response = await fetch(`/api/videos/${id}`, { method: 'DELETE' });
            if (response.ok) {
                fetchVideos();
            } else {
                alert('Failed to delete video.');
            }
        } catch (err) {
            console.error(err);
        }
    }

    function resetUploadUI() {
        uploadBtn.disabled = false;
        videoFileInput.disabled = false;
        setTimeout(() => {
            progressContainer.style.display = 'none';
        }, 5000);
    }
});