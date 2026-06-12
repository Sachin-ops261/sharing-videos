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
        progressStatus.innerText = 'Connecting high-speed stream...';

        try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/videos/upload-stream', true);
            
            xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentComplete = Math.round((event.loaded / event.total) * 100);
                    progressBar.style.width = `${percentComplete}%`;
                    progressBar.innerText = `${percentComplete}%`;
                    
                    const uploadedGB = (event.loaded / (1024 * 1024 * 1024)).toFixed(2);
                    const totalGB = (event.total / (1024 * 1024 * 1024)).toFixed(2);
                    progressStatus.innerText = `Streaming ${uploadedGB} GB of ${totalGB} GB directly to bucket...`;
                }
            };

            xhr.onload = async () => {
                if (xhr.status === 200) {
                    progressStatus.innerText = '🎉 Movie successfully shared!';
                    alert('Movie successfully shared!');
                    videoFileInput.value = '';
                    fetchVideos();
                } else {
                    alert('Upload connection reset by pipeline.');
                }
                resetUploadUI();
            };

            xhr.onerror = () => {
                alert('Network stream interrupted.');
                resetUploadUI();
            };

            xhr.send(file);

        } catch (err) {
            console.error(err);
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