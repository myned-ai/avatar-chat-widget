# Avatar Chat Widget

**Embeddable 3D Avatar Chat Widget** - Real-time Voice & Text Chat with Gaussian Splatting Avatar Animation.

[![npm version](https://img.shields.io/npm/v/@myned-ai/avatar-chat-widget.svg)](https://www.npmjs.com/package/@myned-ai/avatar-chat-widget)

---

## Quick Start

### Script Tag (No Build Required)

Add directly to any HTML page or website builder:

```html
<!-- Container for the widget -->
<div id="avatar-chat"></div>

<!-- Load from CDN -->
<script src="https://cdn.jsdelivr.net/npm/@myned-ai/avatar-chat-widget"></script>

<script>
  AvatarChat.init({
    container: '#avatar-chat',
    serverUrl: 'wss://your-backend-server.com/ws',
    position: 'bottom-right'
  });
</script>
```

### NPM Package

```bash
npm install @myned-ai/avatar-chat-widget
```

```typescript
import { AvatarChat } from '@myned-ai/avatar-chat-widget';
import '@myned-ai/avatar-chat-widget/style.css';

const chat = AvatarChat.init({
  container: '#avatar-chat',
  serverUrl: 'wss://your-backend-server.com/ws',
  theme: 'dark',
  onReady: () => console.log('Widget ready!'),
  onMessage: (msg) => console.log('Message:', msg)
});

// Control programmatically
chat.sendMessage('Hello!');
chat.collapse(); // Minimize to bubble
chat.expand();   // Open full widget
chat.destroy();  // Cleanup
```

---

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `container` | `string \| HTMLElement` | **required** | CSS selector or DOM element |
| `serverUrl` | `string` | **required** | WebSocket server URL (ws:// or wss://) |
| `position` | `string` | `'bottom-right'` | `bottom-right`, `bottom-left`, `top-right`, `top-left`, `inline` |
| `startCollapsed` | `boolean` | `true` | Start minimized as bubble |
| `width` | `number` | `380` | Widget width (200-2000px) |
| `height` | `number` | `550` | Widget height (300-2000px) |
| `enableVoice` | `boolean` | `true` | Enable voice chat |
| `enableText` | `boolean` | `true` | Enable text chat |
| `logLevel` | `string` | `'error'` | `none`, `error`, `warn`, `info`, `debug` |
| `customStyles` | `string` | `undefined` | Custom CSS to inject into Shadow DOM |
| `authEnabled` | `boolean` | `true` | Enable HMAC authentication (disable for dev) |
| `avatarUrl` | `string` | auto-detected | URL to avatar ZIP file |

### Callbacks

| Callback | Type | Description |
|----------|------|-------------|
| `onReady` | `() => void` | Widget initialized and ready |
| `onConnectionChange` | `(connected: boolean) => void` | WebSocket connection status changed |
| `onMessage` | `(msg: {role, text}) => void` | Message received from server |
| `onError` | `(error: Error) => void` | Error occurred |

---

## Customization

### Changing Colors

The widget uses CSS variables that you can override with the `customStyles` option:

```typescript
AvatarChat.init({
  container: '#avatar-chat',
  serverUrl: 'wss://your-server.com/ws',
  customStyles: `
    /* Primary brand colors (gradient, buttons, user messages) */
    .chat-bubble,
    .chat-header {
      background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%) !important;
    }

    .input-button {
      background: #ff6b6b !important;
    }

    .input-button:hover:not(:disabled) {
      background: #ee5a6f !important;
    }

    .message.user .message-bubble {
      background: #ff6b6b !important;
    }

    /* Avatar border */
    .avatar-circle {
      border-color: #ff6b6b !important;
    }

    /* Input focus color */
    #chatInput:focus {
      border-color: #ff6b6b !important;
    }
  `
});
```

**Common color targets:**
- `.chat-bubble` - Minimized bubble
- `.chat-header` - Header gradient
- `.avatar-circle` - Avatar border
- `.input-button` - Send & mic buttons
- `.message.user .message-bubble` - User message bubbles
- `#chatInput:focus` - Input field focus state

---

## Features

- **Text & Voice Chat** - Real-time messaging with microphone streaming
- **3D Avatar** - Gaussian Splatting rendering with 52 ARKit blendshapes
- **Synchronized Animation** - Audio and facial expressions in perfect sync
- **Auto-reconnection** - Resilient WebSocket with exponential backoff
- **Shadow DOM** - Complete CSS isolation, no style conflicts
- **Framework Agnostic** - Works with React, Vue, Angular, or vanilla HTML
- **Accessible** - WCAG 2.1 AA compliant with ARIA labels

---

## WebSocket Protocol

### Client → Server

```json
{ "type": "text", "data": "Hello", "userId": "user_123", "timestamp": 1234567890 }
{ "type": "audio", "data": "<ArrayBuffer>", "format": "audio/webm" }
```

### Server → Client

```json
{ "type": "audio_start", "sessionId": "abc", "sampleRate": 24000 }
{ "type": "audio_chunk", "data": "<ArrayBuffer>", "timestamp": 1234567890 }
{ "type": "blendshape", "weights": {...}, "timestamp": 1234567890 }
{ "type": "audio_end", "sessionId": "abc" }
{ "type": "text", "data": "Hello", "timestamp": 1234567890 }
```

---

## Authentication

### Disabling Auth (Development)

For local testing without an auth server:

```typescript
AvatarChat.init({
  container: '#avatar-chat',
  serverUrl: 'ws://localhost:8080/ws',
  authEnabled: false  // Disable authentication
});
```

### Production Setup

The widget uses HMAC-SHA256 token authentication for secure connections:

1. Widget requests token from `POST /api/auth/token`
2. Server validates origin and returns signed token
3. Widget connects with token: `wss://server/ws?token=...`
4. Server verifies signature and expiration

**Security features:**
- Origin validation (whitelist domains)
- Time-limited tokens with auto-refresh
- Rate limiting per domain/session

---

## Development

### Local Setup

```bash
# Install dependencies
npm install

# Start dev server with hot reload
npm run dev

# Build for production
npm run build:lib
```

### Testing with Backend

```bash
# Clone sample server
git clone https://github.com/myned-ai/avatar-chat-server.git
cd avatar-chat-server

# Start with Docker
docker-compose up
```

Server runs on `ws://localhost:8765` by default.

---

## Browser Requirements

**Supported browsers:**
- Chrome/Edge 90+
- Firefox 89+
- Safari 15.2+

**Production deployment:**

For optimal performance, your server must send these headers to enable SharedArrayBuffer:

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

---

## Troubleshooting

### Widget not loading
- Check browser console for errors
- Verify `serverUrl` is correct WebSocket URL (ws:// or wss://)
- Ensure container element exists before calling `init()`

### Avatar not rendering
- Check server CORS headers (COEP/COOP)
- Verify avatar ZIP file is accessible
- Check `logLevel: 'debug'` for detailed logs

### Voice not working
- Microphone permission required
- HTTPS required for production (getUserMedia)
- Check browser compatibility

---

## Acknowledgements

Built on amazing open-source research:
- [OpenLRM](https://github.com/3DTopia/OpenLRM)
- [GAGAvatar](https://github.com/xg-chu/GAGAvatar)
- [GaussianAvatars](https://github.com/ShenhanQian/GaussianAvatars)
- [VHAP](https://github.com/ShenhanQian/VHAP)
- [LAM](https://github.com/aigc3d/LAM)

Thanks for their excellent works and great contribution.

---

## License

MIT License - see [LICENSE](LICENSE) for details.
