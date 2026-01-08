# Avatar Chat Widget

**Embeddable 3D Avatar Chat Widget** - Real-time Voice & Text Chat with Gaussian Splatting Avatar Animation.

[![npm version](https://img.shields.io/npm/v/@myned-ai/avatar-chat-widget.svg)](https://www.npmjs.com/package/@myned-ai/avatar-chat-widget)

---

## Installation

### Script Tag (No Build Required)

Add directly to any HTML page or website builder:

```html
<!-- Container for the widget -->
<div id="avatar-chat"></div>

<!-- Load from CDN -->
<script src="https://cdn.jsdelivr.net/npm/@myned-ai/avatar-chat-widget"></script>

<script>
  // Initialize the widget
  AvatarChat.init({
    container: '#avatar-chat',
    serverUrl: 'wss://your-backend-server.com/ws',
    position: 'bottom-right',
    theme: 'light'
  });
</script>
```

### Programmatic Control

```typescript
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

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `container` | `string \| HTMLElement` | **required** | CSS selector or DOM element |
| `serverUrl` | `string` | **required** | WebSocket server URL |
| `position` | `string` | `'bottom-right'` | Position: `bottom-right`, `bottom-left`, `top-right`, `top-left`, `inline` |
| `theme` | `string` | `'light'` | Theme: `light`, `dark`, `auto` |
| `startCollapsed` | `boolean` | `true` | Start minimized as bubble |
| `width` | `number` | `380` | Widget width in pixels |
| `height` | `number` | `550` | Widget height in pixels |
| `logLevel` | `string` | `'error'` | Log level: `none`, `error`, `warn`, `info`, `debug` |
| `customStyles` | `string` | `undefined` | Custom CSS to inject |
| `authEnabled` | `boolean` | `true` | Enable HMAC token authentication |

### Callbacks

| Callback | Type | Description |
|----------|------|-------------|
| `onReady` | `() => void` | Called when widget is initialized |
| `onConnectionChange` | `(connected: boolean) => void` | Connection status changes |
| `onMessage` | `(msg: {role, text}) => void` | Message received |
| `onError` | `(error: Error) => void` | Error occurred |

---

## Development

### Local Development

```bash
# Install dependencies
npm install

# Start development server (SPA mode)
npm run dev

# Build library for distribution
npm run build:lib

# Build both SPA and library
npm run build:all
```

### Test with Sample Backend Server

```bash
# Clone the avatar chat server
git clone https://github.com/myned-ai/avatar-chat-server.git
cd avatar-chat-server

# Follow the instructions in the repository to start the Docker container
docker-compose up
```

The server will start on `ws://localhost:8765` by default.

---

## Features

- **Text & Voice Chat** - Real-time messaging with microphone streaming
- **3D Avatar** - Gaussian Splatting rendering with 52 ARKit blendshapes
- **Synchronized Animation** - Audio and facial expressions in perfect sync
- **Auto-reconnection** - Resilient WebSocket with exponential backoff
- **Shadow DOM** - CSS isolated, no style conflicts
- **Accessible** - WCAG 2.1 AA compliant

---

## Avatar Rendering Engine

This widget uses [@myned-ai/gsplat-flame-avatar-renderer](https://www.npmjs.com/package/@myned-ai/gsplat-flame-avatar-renderer), a specialized Gaussian Splatting library for rendering animated 3D avatars.

### Animation States

| State | Animation Index | Description |
|-------|-----------------|-------------|
| **Idle** | 1 | Subtle breathing and micro-movements |
| **Hello** | 2 | Attentive greeting posture |
| **Responding** | 6 | Speaking body movements (head sway, gestures) |

### Eye Blink Behavior

The widget handles all eye blinking on the frontend for consistent behavior across states. Blink intervals vary by avatar state:

| State | Interval | Description |
|-------|----------|-------------|
| **Idle** | 2-4 seconds | Relaxed, natural blinking |
| **Hello** | 1.8-3.5 seconds | Attentive, slightly more frequent |
| **Responding** | 1.3-3.3 seconds | Natural speaking rate |

Each blink uses randomized patterns and intensity (80-100%) for natural variation.

### Avatar Asset Format

The widget loads a modified LAM based avatar from ZIP file containing:

```
avatar.zip
├── avatar/
│   ├── offset.ply             # Gaussian splats point cloud
│   ├── animation.glb          # Animation clips
│   ├── skin.glb               # Skinning/skeleton data
│   ├── vertex_order.json      # Vertex ordering
│   └── iris_occlusion.json    # Iris occlusion ranges (optional)
```

### Browser Requirements

For production deployment, your server must send these headers to enable SharedArrayBuffer (used for high-performance sorting):

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

---

## Directory Structure

| Path | Files | Description |
|------|-------|-------------|
| `src/` | 3 | Entry points (`widget.ts`, `main.ts`, `config.ts`) |
| `src/avatar/` | 3 | Avatar rendering (`GaussianAvatar`, `LazyAvatar`) |
| `src/constants/` | 2 | ARKit blendshape constants |
| `src/managers/` | 2 | Chat orchestration (`ChatManager`) |
| `src/services/` | 8 | Core services (audio, WebSocket, blendshapes) |
| `src/types/` | 4 | TypeScript type definitions |
| `src/utils/` | 9 | Shared utilities (logging, buffers, protocols) |

### Key Components

| Component | Description |
|-----------|-------------|
| `widget.ts` | Main entry point, `AvatarChat.init()` API |
| `ChatManager` | Orchestrates services, handles state transitions |
| `GaussianAvatar` | Wrapper for gsplat-flame-avatar-renderer |
| `SocketService` | WebSocket connection with auto-reconnect |
| `AudioInput` | Microphone capture (PCM16 for OpenAI Realtime API) |
| `AudioOutput` | Audio playback with Web Audio API |
| `SyncPlayback` | Synchronized audio + blendshape playback |
| `BlendshapeBuffer` | Frame buffer for smooth animation |
| `AuthService` | HMAC token authentication |
| `Logger` | Centralized logging with levels |

---

## Architecture

```
Frontend (This Widget)        Backend (Your Server)
┌─────────────────────┐      ┌──────────────────────┐
│   Widget (Shadow)   │◄────►│   WebSocket Server   │
│   ├─ Chat UI        │      │   ├─ AI/LLM          │
│   ├─ Voice I/O      │      │   ├─ TTS             │
│   └─ Avatar         │      │   └─ Blendshape Gen  │
└─────────────────────┘      └──────────────────────┘
```

---

## WebSocket Protocol

**Client to Server:**
```json
{ "type": "text", "data": "Hello", "userId": "user_123", "timestamp": 123 }
{ "type": "audio", "data": "<ArrayBuffer>", "format": "audio/webm" }
```

**Server to Client:**
```json
{ "type": "audio_start", "sessionId": "abc", "sampleRate": 24000 }
{ "type": "audio_chunk", "data": "<ArrayBuffer>", "timestamp": 124 }
{ "type": "blendshape", "weights": {...}, "timestamp": 124 }
{ "type": "audio_end", "sessionId": "abc" }
```

---

## Authentication

The widget uses HMAC token authentication by default for secure WebSocket connections.

### Disabling Authentication (Development)

For local development without an auth server:

```typescript
AvatarChat.init({
  container: '#avatar-chat',
  serverUrl: 'ws://localhost:8080/ws',
  authEnabled: false  // Disable for local testing
});
```

### How It Works

1. Widget requests a token from `POST /api/auth/token`
2. Server validates origin and returns HMAC-signed token
3. Widget connects to WebSocket with token: `ws://server/ws?token=...`
4. Server verifies token signature and expiration

### Authentication Flow

```
Widget                          Server
  │                               │
  │  POST /api/auth/token         │
  │  Origin: https://yoursite.com │
  │──────────────────────────────►│
  │                               │ Validate origin
  │     {token, ttl, origin}      │ Generate HMAC token
  │◄──────────────────────────────│
  │                               │
  │  WebSocket /ws?token=...      │
  │──────────────────────────────►│
  │                               │ Verify token
  │        Connection OK          │ Check rate limits
  │◄──────────────────────────────│
```

### Security Features

- **Origin validation** - Only whitelisted domains can connect
- **HMAC-SHA256 tokens** - Cryptographically signed, time-limited
- **Rate limiting** - Per-domain and per-session limits
- **Auto-refresh** - Tokens refresh automatically before expiry

### Server Requirements

The backend must implement:
- `POST /api/auth/token` - Returns `{token, ttl, origin}`
- WebSocket token verification via query parameter

---

### Acknowledgement

This work is built on many amazing research works and open-source projects:
- [OpenLRM](https://github.com/3DTopia/OpenLRM)
- [GAGAvatar](https://github.com/xg-chu/GAGAvatar)
- [GaussianAvatars](https://github.com/ShenhanQian/GaussianAvatars)
- [VHAP](https://github.com/ShenhanQian/VHAP)
- [LAM](https://github.com/aigc3d/LAM)

Thanks for their excellent works and great contribution.

---

## License

MIT License - see [LICENSE](LICENSE) for details.
