// Example: How to use the chat widget with your avatar renderer
//
// The chat widget is renderer-agnostic. It accepts any avatar that 
// implements IAvatarController interface.
//
// LazyAvatar loads the heavy 3D renderer in the background while
// showing a lightweight placeholder. This keeps initial page load fast.

// Lazy loader - only imports types, not the heavy renderer
import { LazyAvatar } from './avatar/LazyAvatar';
import { ChatManager } from './managers/ChatManager';
import { logger } from './utils/Logger';

const log = logger.scope('Main');

// Wait for DOM to be ready
window.addEventListener('DOMContentLoaded', async () => {
	// Get the avatar circle container
	const avatarCircle = document.getElementById('avatarCircle') as HTMLDivElement;
	if (!avatarCircle) {
		throw new Error('avatarCircle element not found');
	}

	// Clear placeholder
	avatarCircle.innerHTML = '';
	
	// Create a larger container for high-quality rendering (800x800)
	// The CSS will scale it down to fit the 120px circle
	const renderContainer = document.createElement('div');
	renderContainer.className = 'avatar-render-container';
	renderContainer.style.width = '800px';
	renderContainer.style.height = '800px';
	avatarCircle.appendChild(renderContainer);
	
	// Debug: log container dimensions
	log.debug('Render container dimensions: 800 x 800 (will scale down to fit circle)');

	const assetPath = './asset/nyx.zip';
	log.info('Loading avatar from:', assetPath);

	// Create lazy avatar - renders into the HIGH-RES container
	const avatar = new LazyAvatar(renderContainer, assetPath, {
		preload: true,
		onReady: () => {
			log.info('Avatar loaded and ready');
			// Debug: inspect what was added to the container
			log.debug('Render container children:', renderContainer.children.length);
			const canvas = renderContainer.querySelector('canvas');
			if (canvas) {
				log.debug('Canvas found:', canvas.width, 'x', canvas.height);
			} else {
				log.debug('No canvas found');
			}
		},
		onError: (err) => log.error('Avatar failed to load:', err)
	});
	avatar.start();

	// Create chat widget
	const chatManager = new ChatManager(avatar);

	// Initialize chat system
	try {
		await chatManager.initialize();
		log.info('Chat system initialized');
	} catch (error) {
		log.error('Failed to initialize chat system:', error);
	}

	// Cleanup on page unload
	window.addEventListener('beforeunload', () => {
		chatManager.dispose();
		avatar.dispose();
	});
});