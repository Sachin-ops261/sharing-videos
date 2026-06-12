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
        progressStatus.innerText = 'Requesting direct storage upload pass...';

        try {
            // 1. Fetch direct cloud authorization URL from Render
            const tokenRes = await fetch('/api/videos/get-presigned-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.name, contentType: file.type })
            });

            if (!tokenRes.ok) throw new Error('Render rejected upload ticket generation');
            const { uploadUrl, b2Key } = await tokenRes.json();

            // 2. Upload file DIRECTLY to Backblaze storage bypasses Render gateway completely
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', uploadUrl, true);
            xhr.setRequestHeader('Content-Type', file.type);

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentComplete = Math.round((event.loaded / event.total) * 100);
                    progressBar.style.width = `${percentComplete}%`;
                    progressBar.innerText = `${percentComplete}%`;
                    
                    const uploadedGB = (event.loaded / (1024 * 1024 * 1024)).toFixed(2);
                    const totalGB = (event.total / (1024 * 1024 * 1024)).toFixed(2);
                    progressStatus.innerText = `Uploading directly to Backblaze: ${uploadedGB} GB of ${totalGB} GB...`;
                }
            };

            xhr.onload = async () => {
                if (xhr.status === 200) {
                    progressStatus.innerText = 'Saving video entry to database...';
                    
                    // 3. Notify Render that the file is safe in Backblaze
                    const registerRes = await fetch('/api/videos/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filename: file.name, b2Key })
                    });

                    if (registerRes.ok) {
                        progressStatus.innerText = '🎉 Movie successfully shared!';
                        alert('Movie successfully shared!');
                        videoFileInput.value = '';
                        fetchVideos();
                    } else {
                        alert('Failed to register upload with database.');
                    }
                } else {
                    alert(`Cloud storage rejected transfer with status code: ${xhr.status}`);
                }
                resetUploadUI();
            };

            xhr.onerror = () => {
                alert('Direct cloud connection failed.');
                resetUploadUI();
            };

            xhr.send(file);

        } catch (err) {
            console.error(err);
            alert(`Setup error: ${err.message}`);
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