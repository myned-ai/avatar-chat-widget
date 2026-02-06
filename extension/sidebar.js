document.addEventListener('DOMContentLoaded', () => {
    // Initialize the widget
    // Note: Update serverUrl to your actual backend
    // Fetch avatar as Blob to bypass "chrome-extension:" protocol check
    fetch('./dist/asset/nyx.zip')
        .then(response => response.blob())
        .then(blob => {
            const avatarBlobUrl = URL.createObjectURL(blob);
            console.log('DEBUG: Generated Blob URL:', avatarBlobUrl);
            const parsed = new URL(avatarBlobUrl);
            console.log('DEBUG: Blob protocol:', parsed.protocol);
            console.log('DEBUG: Window location:', window.location.href);

            if (window.AvatarChat) {
                window.AvatarChat.init({
                    container: '#avatar-chat',
                    serverUrl: 'ws://localhost:8080/ws',
                    avatarUrl: avatarBlobUrl,
                    position: 'inline', // Use inline mode to fill container
                    startCollapsed: false,
                    enableVoice: true,
                    width: Math.max(200, window.innerWidth),
                    height: Math.max(300, window.innerHeight)
                });
            } else {
                console.error('AvatarChat library not loaded');
            }
        })
        .catch(err => console.error('Failed to load avatar asset:', err));
});
