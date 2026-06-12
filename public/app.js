// Dynamically load the resilient Tus client library directly into the frontend window context
const script = document.createElement('script');
script.src = "https://cdn.jsdelivr.net/npm/tus-js-client@3.0.1/dist/tus.min.js";
document.head.appendChild(script);

document.addEventListener('DOMContentLoaded', () => {
    const videoFileInput = document.getElementById('videoFile');
    const uploadBtn = document.getElementById('uploadBtn');
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressStatus = document.getElementById('progressStatus');
    const videoListContainer = document.getElementById('videoList');

    fetchVideos();

    uploadBtn.addEventListener('click', () => {
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
        progressStatus.innerText = 'Establishing chunked resumable pipeline...';

        // Initialize a stable Tus upload stream session
        const upload = new tus.Upload(file, {
            endpoint: "/api/videos/upload-tus",
            retryDelays: [0, 1000, 3000, 5000], // Auto-reconnects instantly if Render lags
            metadata: {
                filename: file.name,
                filetype: file.type
            },
            chunkSize: 1024 * 1024 * 5, // Breaks your 4GB file into safe 5MB parts
            onError: function (error) {
                console.error("Failed because: " + error);
                alert("Upload pipeline paused. Click Start Upload again to pick up where you left off.");
                resetUploadUI();
            },
            onProgress: function (bytesUploaded, bytesTotal) {
                const percentComplete = Math.round((bytesUploaded / bytesTotal) * 100);
                progressBar.style.width = `${percentComplete}%`;
                progressBar.innerText = `${percentComplete}%`;
                
                const uploadedGB = (bytesUploaded / (1024 * 1024 * 1024)).toFixed(2);
                const totalGB = (bytesTotal / (1024 * 1024 * 1024)).toFixed(2);
                progressStatus.innerText = `Chunking ${uploadedGB} GB of ${totalGB} GB safely past gateway...`;
            },
            onSuccess: function () {
                progressStatus.innerText = '🎉 Video successfully shared!';
                alert('Video successfully shared!');
                videoFileInput.value = '';
                // Give Postgres half a second to finish row instantiation
                setTimeout(fetchVideos, 800);
                resetUploadUI();
            }
        });

        // Fire the upload session
        upload.start();
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