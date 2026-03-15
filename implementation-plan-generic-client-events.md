# Generic Client Event Implementation Plan

This plan details the architecture for adding a generic `client_event` protocol, file/image attachments, and server-to-client rich messaging to the Nyx Avatar Widget and AI server. It establishes a two-way data channel for sending background data, state, or context between the host website and the AI Server.

---

## 1. Core Foundation: `client_event` Protocol

The widget must be able to silently send structured data to the AI server to provide context or trigger specific AI behaviors, without it appearing as a user message in the chat window.

### Example Usage and Rationale

**Why it was implemented:**
Imagine an e-commerce website where the user is browsing a product page. The AI assistant should know *which product they're looking at* without the user having to say it out loud. A `client_event` allows the host website to silently whisper context to the AI (e.g., `viewing_product: { name: "Nike Air Max", price: 120 }`), so the AI can proactively say: *"Great choice! Want me to tell you more about the Nike Air Max?"*

**How to use it:**
After initializing the widget, use `widget.sendEvent()` from any JavaScript running on your host site:
```javascript
// Fired when the user navigates to a product page
widget.sendEvent('viewing_product', { name: 'Nike Air Max', price: 120, sku: 'NK-AM-001' }, { directive: 'context' });

// Directive 'speak' immediately interrupts the AI to address a critical event
widget.sendEvent('payment_failed', { reason: 'insufficient_funds' }, { directive: 'speak' });

// Directive 'trigger' executes a hardcoded server action without involving the LLM at all
widget.sendEvent('session_expired', {}, { directive: 'trigger' });
```

### 1.1 Protocol Interface

> [!IMPORTANT]
> The codebase has **two separate type systems** for messages: `src/types/protocol.ts` (used by `AvatarProtocolClient`) and `src/types/messages.ts` (used by `SocketService`). New types must be added to **both files** and their respective union types (`OutgoingMessage`) to avoid runtime type mismatches.

#### `src/types/protocol.ts` — add to Client-to-Server Events section:

```typescript
export interface ClientEventMessage {
  type: 'client_event';

  /** The name of the event (e.g. 'search_results', 'viewing_item', 'user_identified') */
  name: string;

  /** Any JSON data associated with this event */
  data?: Record<string, any>;

  /**
   * Instruction for how the Server/AI should handle this payload.
   * 'context': Silently append to history for the next time the user speaks.
   * 'speak': Interrupt the AI immediately and ask it to comment on this event.
   * 'trigger': Bypass LLM generation entirely and execute a hardcoded server function.
   * (Default: 'context')
   */
  directive?: 'context' | 'speak' | 'trigger';
}
```

Then update the `OutgoingMessage` union in `protocol.ts`:
```diff
 export type OutgoingMessage =
   | AudioStreamStartMessage
   | AudioMessage
   | TextMessage
   | InterruptMessage
-  | PingMessage;
+  | PingMessage
+  | ClientEventMessage;
```

#### `src/types/messages.ts` — add a mirrored definition:

```typescript
export interface ClientEventOutMessage extends BaseMessage {
  type: 'client_event';
  name: string;
  data?: Record<string, any>;
  directive?: 'context' | 'speak' | 'trigger';
}
```

Then update the `OutgoingMessage` union in `messages.ts`:
```diff
 export type OutgoingMessage =
   | OutgoingTextMessage
   | OutgoingAudioMessage
   | AudioStreamStartMessage
   | AudioStreamEndMessage
   | AudioInputMessage
   | PingMessage
   | ChatMessageOut
-  | InterruptOutMessage;
+  | InterruptOutMessage
+  | ClientEventOutMessage;
```

### 1.2 Widget Implementation

#### `src/services/AvatarProtocolClient.ts`

Add a new public method next to the existing `sendText()`:

```typescript
/**
 * Send a background client event to the server.
 * This data is NOT displayed in the chat UI.
 */
public sendClientEvent(
  name: string,
  data?: Record<string, any>,
  directive: 'context' | 'speak' | 'trigger' = 'context'
) {
  log.info('Sending client event', { name, directive });
  const msg = { type: 'client_event', name, data, directive };
  this.socket.send(msg as OutgoingMessage);
}
```

> [!NOTE]
> The existing `sendText()` method already casts to `OutgoingMessage` and passes through `SocketService.send()`, which serializes to JSON via `JSON.stringify`. No transport-layer changes needed — `SocketService` just sees another JSON message.

#### `src/managers/ChatManager.ts`

Expose a pass-through method:

```typescript
public sendClientEvent(
  name: string,
  data?: Record<string, any>,
  directive?: 'context' | 'speak' | 'trigger'
) {
  this.protocolClient.sendClientEvent(name, data, directive);
}
```

#### `src/widget/types.ts` — `AvatarChatInstance` interface

Add to the public API surface:

```diff
 export interface AvatarChatInstance {
   sendMessage(text: string): void;
+  /** Send a background event to the AI server (not shown in chat) */
+  sendEvent(name: string, data?: Record<string, any>, options?: { directive?: 'context' | 'speak' | 'trigger' }): void;
   mount(): void;
   destroy(): void;
   // ...
 }
```

#### `src/widget.ts` — `AvatarChatElement` and `init()` return object

In the `AvatarChatElement` class, add a method:

```typescript
public sendEvent(
  name: string,
  data?: Record<string, any>,
  options?: { directive?: 'context' | 'speak' | 'trigger' }
) {
  if (!this.chatManager) {
    log.warn('sendEvent called before chatManager initialized — ignoring');
    return;
  }
  this.chatManager.sendClientEvent(name, data, options?.directive);
}
```

Then in the `init()` function (which builds the `AvatarChatInstance` facade), include it:

```diff
 return {
   sendMessage: (text: string) => element.sendText(text),
+  sendEvent: (name, data, options) => element.sendEvent(name, data, options),
   mount: () => element.mount(),
   // ...
 };
```

**Example usage by any host website:**

```javascript
// Send data silently for context
widget.sendEvent('user_identified', { name: "John" }, { directive: 'context' });

// Force the AI to speak about an event immediately
widget.sendEvent('payment_failed', { reason: "insufficient_funds" }, { directive: 'speak' });
```

> [!TIP]
> Connection readiness: `SocketService.send()` already queues messages when disconnected and flushes on reconnect, so `sendEvent` calls before the WebSocket opens will be automatically buffered and delivered.

### 1.3 Server Implementation (Python)

The AI backend's WebSocket message loop must handle interception of the `client_event` message type.

1. **Interception**: In the WebSocket receive loop, check for `msg['type'] == 'client_event'`.
2. **Routing by Directive**:
   - **`context`**: Format the event into an injected system block:
     ```python
     context_block = (
       f"<system>Client Event '{msg['name']}': "
       f"{json.dumps(msg.get('data', {}))}</system>"
     )
     conversation_history.append({"role": "user", "parts": [{"text": context_block}]})
     ```
     This block is appended silently; no LLM generation is triggered.
   - **`speak`**: Append the same block, then immediately trigger the LLM to generate a response evaluating the event. The AI proactively speaks to the user.
   - **`trigger`**: Look up `msg['name']` in a registered function map and execute directly, bypassing the LLM entirely.

> [!WARNING]
> **Idempotency**: High-frequency events (e.g., `viewport_update` on scroll) could flood the conversation history. The server should implement deduplication or a sliding-window strategy — only keep the **latest** event of a given `name` in history, replacing the previous one.

---

## 2. Image and File Uploads (Attachments)

To support sending images or files from the widget to the server (either standalone or accompanying a text message).

### Example Usage and Rationale

**Why it was implemented:**
Text-only interactions limit the AI's ability to help with visual tasks. A user might encounter an error on the site, want to share a PDF document for summary, or upload a photo of a product they want to find. By supporting native file attachments over the WebSocket, we drastically increase the agent's utility as a multimodal assistant.

**How to use it:**
1. A user clicks the paperclip icon in the widget and selects an image.
2. The widget asynchronously converts the image to Base64.
3. Upon hitting send, the widget dispatches the payload:
   ```javascript
   chatManager.sendText("Can you explain this error message?", [{
     mime_type: "image/jpeg",
     content: "base64data...",
     filename: "error.jpg"
   }]);
   ```
4. The AI server receives it, unwraps the Base64, and feeds it directly into the Gemini or OpenAI vision model alongside the text prompt.

### 2.1 Protocol Update

> [!IMPORTANT]
> The existing `TextMessage` in `protocol.ts` uses `{ type: 'text', data: string }` — the text content lives in the `data` field, **not** a `text` field. The attachment interface must align with this.

#### `src/types/protocol.ts`:

```typescript
export interface AttachmentData {
  /** Base64 encoded file content */
  content: string;
  /** MIME type (e.g., 'image/jpeg', 'application/pdf') */
  mime_type: string;
  /** Original file name */
  filename?: string;
}
```

Modify `TextMessage` to support the optional attachment:

```diff
 export interface TextMessage {
   type: 'text';
   data: string;
+  attachments?: AttachmentData[];
 }
```

> [!NOTE]
> Using an `attachments` array (plural) instead of a single `attachment` is future-proof for multi-file uploads without a protocol version bump. The `content` field holds Base64 data; for files larger than ~4MB, we should use a separate HTTP upload endpoint and pass a URL reference instead.

#### `src/types/messages.ts` — mirror the change:

```diff
 export interface OutgoingTextMessage extends BaseMessage {
   type: 'text';
   data: string;
   userId: string;
+  attachments?: AttachmentData[];
 }
```

### 2.2 Client & Widget Changes

1. **UI Elements** (`src/widget/templates.ts` and `src/widget/styles.ts`):
   - Add a "paperclip" / attachment icon button inside the chat input bar (alongside the existing send/mic buttons).
   - Create a hidden `<input type="file" accept="image/*,.pdf" multiple>` that the button triggers.
   - Add `dragover` / `drop` event listeners on the chat overlay container.
   - Add a `paste` event listener on the text input to capture clipboard images (screenshots).

2. **Attachment State & Preview** (`src/widget.ts` or a new `AttachmentManager`):
   - Maintain a `pendingAttachments: File[]` array.
   - When file(s) are selected/dropped/pasted, render a preview strip above the input (thumbnail for images, file-icon + name for others).
   - Provide an "X" button on each preview to remove it.

3. **Send Flow** (modify `AvatarProtocolClient.sendText()`):
   ```typescript
   public sendText(text: string, attachments?: File[]) {
     const msg: any = { type: 'text', data: text };

     if (attachments?.length) {
       // Convert File objects to AttachmentData via FileReader (async)
       // This must be awaited before send — consider making sendText async
       // or pre-processing attachments into base64 before calling sendText.
     }

     this.socket.send(msg as OutgoingMessage);
   }
   ```

   > [!IMPORTANT]
   > `FileReader.readAsDataURL()` is async. The attachments must be converted to Base64 **before** calling `socket.send()`. Two approaches:
   > - **Option A**: Pre-process in the UI layer and pass `AttachmentData[]` (already Base64) to `sendText`.
   > - **Option B**: Make `sendText` async and `await` the conversion internally.
   > Option A is recommended — it keeps the protocol client synchronous and simple.

4. **File Size Guard** (client-side, before encoding):
   - Reject files > 5MB with a user-visible toast/error.
   - Validate MIME type against an allowlist: `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `application/pdf`.

### 2.3 Server Changes (Python / LLM Integration)

1. **Message Parsing**: When `msg['type'] == 'text'` and `msg.get('attachments')` is present, decode each attachment's Base64 `content`.

2. **LLM Formatting** (Gemini multimodal API):
   ```python
   user_parts = [{"text": msg.get("data", "")}]   # Note: field is 'data', not 'text'

   for att in msg.get("attachments", []):
       user_parts.append({
           "inline_data": {      # Gemini SDK uses snake_case
               "mime_type": att["mime_type"],
               "data": att["content"]
           }
       })

   response = chat_session.send_message(user_parts)
   ```

3. **Security & Validation**:
   - Server-side file size limit: reject Base64 payloads where `len(content) > 7_000_000` (~5MB decoded).
   - Validate `mime_type` against allowlist.
   - Optionally scan file content signature (magic bytes) to prevent MIME spoofing.

---

## 3. Server-to-Client Rich Messaging (Custom Payloads)

To allow the server to send complex structured data (tables, diagrams, cards, interactive elements) back to the client alongside text.

### Example Usage and Rationale

**Why it was implemented:**
Voice and text are sometimes inefficient for conveying complex data. If a user asks the AI to "compare pricing plans," it's tedious to listen to the AI read out a 5-minute matrix of features. Rich messaging allows the AI to say "Here is a comparison of our plans!" while instantly projecting a visual Pricing Table UI into the chat widget for the user to read or interact with.

**How to use it:**
First, the frontend developer registers a custom renderer for the widget:
```javascript
widget.registerRichRenderer('pricing_table', (payload, container) => {
  // Use payload data to draw a custom HTML table inside the container
  container.innerHTML = generateTableHTML(payload.plans);
});
```
Then, the AI decides to trigger the `send_rich_content` tool with `content_type="pricing_table"` and a JSON payload containing the plan data. The widget catches the payload and renders the beautiful custom UI in the chat feed exactly when the AI speaks about it.

### 3.1 Industry Best Practices

| Platform | Pattern | Flexibility |
|---|---|---|
| **MS Bot Framework** (Adaptive Cards) | `attachments[]` with `contentType` + `content` JSON | High — client dispatches on `contentType` |
| **Slack** (Block Kit) | `blocks[]` with `type` field | Medium — predefined block types |
| **Dialogflow** | `custom` payload (arbitrary JSON) | Maximum — client interprets everything |

**Our approach**: A hybrid model using `type`, `subtype`, and arbitrary `payload`. This gives the client enough metadata to route rendering without hardcoding specific UI components into the core protocol.

### 3.2 Protocol Update

Rich content can arrive in **two ways**:
- **Inline with a conversation turn** — attached to the AI's speech response (natural end-of-turn).
- **Standalone / Async push** — sent by the server at any time, completely independent of any conversation turn. This covers the case where the agent runs as a background service and needs to push data to the client on its own schedule (e.g., a background job completes, an external webhook fires, a scheduled reminder triggers).

#### `src/types/protocol.ts` — add to Server-to-Client Events section:

```typescript
export interface RichContentItem {
  /** High-level category (e.g., 'table', 'media', 'card', 'interactive', 'link') */
  type: string;

  /** Specific variant or rendering hint (e.g., 'chart_js', 'product_card', 'poll') */
  subtype?: string;

  /**
   * Arbitrary JSON payload. Structure depends entirely on the type/subtype.
   * The widget's registered renderer for this type will receive this object.
   */
  payload: Record<string, any>;
}
```

#### Delivery Channel A: Inline with conversation turn

Add an optional `rich_content` field to `TranscriptDoneEvent` so rich media arrives at the natural end-of-turn boundary:

```diff
 export interface TranscriptDoneEvent extends ProtocolEvent {
   type: 'transcript_done';
   role: 'assistant' | 'user';
   text: string;
   turnId: string;
   interrupted?: boolean;
   itemId?: string;
+  rich_content?: RichContentItem[];
 }
```

#### Delivery Channel B: Standalone async push (`server_event`)

A new top-level message type that the server can send at any time, without an active conversation turn:

```typescript
/**
 * Sent by the server asynchronously, independent of any conversation turn.
 * Used when the agent runs as a background service and wants to push
 * data, notifications, or rich UI to the client on its own schedule.
 */
export interface ServerEventMessage extends ProtocolEvent {
  type: 'server_event';

  /** Event name for routing (e.g., 'order_update', 'reminder', 'background_result') */
  name: string;

  /** Optional text to display as a chat bubble (if the event has a spoken/written component) */
  text?: string;

  /** Optional rich content items to render in the chat feed */
  rich_content?: RichContentItem[];

  /** If true, the widget should play a notification sound / visual indicator */
  notify?: boolean;
}
```

Add to the `IncomingMessage` union in `messages.ts`:

```diff
 export type IncomingMessage = 
   | IncomingTextMessage 
   | AudioStartMessage 
   // ...
   | TranscriptDoneMessage
-  | ConfigMessage;
+  | ConfigMessage
+  | ServerEventMessage;
```

> [!IMPORTANT]
> The key difference: `TranscriptDoneEvent` + `rich_content` is for **"the AI just spoke and here's accompanying visual data"**. `ServerEventMessage` is for **"the server has something to say/show right now, outside of any conversation turn"** — the agent doesn't need to be mid-response.

### 3.3 Client & Widget Implementation — Renderer Registry

The widget acts as a rendering switchboard, delegating UI creation to registered handlers.

**Internal architecture:**

```typescript
// Type definition for a rich content renderer function
type RichContentRenderer = (
  payload: Record<string, any>,
  container: HTMLElement,
  shadowRoot: ShadowRoot
) => void;

// Registry inside AvatarChatElement or ChatManager
private richRenderers = new Map<string, RichContentRenderer>();

private getRendererKey(type: string, subtype?: string): string {
  return subtype ? `${type}:${subtype}` : type;
}
```

**Public API** (`src/widget/types.ts`):

```diff
 export interface AvatarChatInstance {
   sendMessage(text: string): void;
   sendEvent(...): void;
+  /**
+   * Register a custom renderer for server-sent rich content.
+   * When the server sends a rich_content item matching this type/subtype,
+   * the provided renderer function will be called to produce the UI.
+   */
+  registerRichRenderer(
+    type: string,
+    subtypeOrRenderer: string | RichContentRenderer,
+    renderer?: RichContentRenderer
+  ): void;
+  /** Register a handler for standalone server-pushed events */
+  onServerEvent(name: string, handler: (event: ServerEventMessage) => void): void;
   mount(): void;
   // ...
 }
```

**Shared rendering helper** (used by both channels):

```typescript
private renderRichContent(items: RichContentItem[]): void {
  for (const item of items) {
    const key = this.getRendererKey(item.type, item.subtype);
    const renderer = this.richRenderers.get(key)
      ?? this.richRenderers.get(item.type)       // fallback: type-only match
      ?? this.defaultRichRenderer;                // fallback: debug renderer

    const container = document.createElement('div');
    container.className = 'nyx-rich-content-item';
    renderer(item.payload, container, this.shadowRoot);
    this.chatMessages?.appendChild(container);
  }
}
```

**Channel A — inline with conversation** (inside `ChatManager.handleTranscriptDone()`):

```typescript
if (event.role === 'assistant' && event.rich_content?.length) {
  this.renderRichContent(event.rich_content);
}
```

**Channel B — standalone async push** (new handler in `ChatManager.setupProtocolHandlers()`):

```typescript
// Listen for standalone server events
this.protocolClient.on('server_event', (event: ServerEventMessage) => {
  log.info('Received server event', { name: event.name });

  // If the event includes text, render it as an assistant chat bubble
  if (event.text) {
    this.transcriptManager.appendAssistantMessage(event.text);
  }

  // Render any rich content items
  if (event.rich_content?.length) {
    this.renderRichContent(event.rich_content);
  }

  // Notify the user (sound/visual pulse) if requested
  if (event.notify) {
    this.emit('notification', event);
  }

  // Dispatch to any host-registered event-specific handler
  const handler = this.serverEventHandlers.get(event.name);
  if (handler) handler(event);
});
```

**Fallback renderer** (default):

```typescript
private defaultRichRenderer: RichContentRenderer = (payload, container) => {
  container.innerHTML = `
    <div class="nyx-rich-fallback">
      <small>Unsupported content type</small>
      <pre>${JSON.stringify(payload, null, 2).slice(0, 500)}</pre>
    </div>`;
};
```

**Host site example:**

```javascript
widget.registerRichRenderer('table', (payload, container) => {
  // payload = { columns: ["Name", "Price"], rows: [["Shirt", "$29"], ...] }
  const table = document.createElement('table');
  // ... build table from payload ...
  container.appendChild(table);
});

// With subtype for a more specific renderer
widget.registerRichRenderer('media', 'chart_js', (payload, container) => {
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  new Chart(canvas, payload.chartConfig);
});
```

### 3.4 Server-Side Execution (Python)

#### Inline with conversation turn (Channel A)

When the AI calls a tool (e.g., `get_weather(city="London")`), the Python tool function returns both a text summary for the LLM and optional `rich_content` for the client:

```python
def get_weather(city: str) -> dict:
    data = fetch_weather_api(city)
    return {
        "llm_summary": f"Current weather in {city}: {data['temp']}°C, {data['desc']}",
        "rich_content": [{
            "type": "card",
            "subtype": "weather",
            "payload": {"city": city, "temp": data["temp"], "icon": data["icon_url"]}
        }]
    }
```

The server attaches the `rich_content` to the `transcript_done` message at the end of the AI's turn.

#### Standalone async push (Channel B)

The server can push a `server_event` message at any time over the existing WebSocket, without any conversation context. This is the pattern for background agent services:

```python
# Example: background job completes and pushes results to the client
async def on_background_job_complete(ws, job_result):
    await ws.send_json({
        "type": "server_event",
        "name": "job_complete",
        "text": f"Your report is ready: {job_result['title']}",
        "rich_content": [{
            "type": "card",
            "subtype": "download",
            "payload": {
                "title": job_result["title"],
                "url": job_result["download_url"],
                "size": job_result["file_size"]
            }
        }],
        "notify": True
    })

# Example: external webhook triggers a proactive notification
async def on_external_webhook(ws, webhook_data):
    await ws.send_json({
        "type": "server_event",
        "name": "order_status_update",
        "text": "Your order has shipped! 🚚",
        "rich_content": [{
            "type": "card",
            "subtype": "tracking",
            "payload": {
                "order_id": webhook_data["order_id"],
                "tracking_url": webhook_data["tracking_url"],
                "eta": webhook_data["estimated_delivery"]
            }
        }],
        "notify": True
    })
```

> [!TIP]
> The `notify` flag is useful for async pushes — if the widget is collapsed or the user isn't actively looking at the chat, the widget can show a badge count or play a subtle notification sound to draw attention.

---

## 4. Generic Use Cases

With this architecture implemented, any host site can build:

- **Screen / Context Awareness**: Send `viewport_update` events as the user scrolls, so the AI knows what elements are visible.
- **Search Resolution**: AI triggers a client action → client searches → client sends results back via `sendEvent('search_results', results, { directive: 'speak' })` → AI disambiguates.
- **Proactive Engagement**: Fire events on timeouts, route changes, or form errors to trigger proactive AI assistance.
- **Visual Data Display**: Server sends tables, charts, cards, or link previews as `rich_content` — the widget renders them inline in the chat feed.

---

## 5. Advanced Architecture Considerations (Enterprise-Grade Features)

To ensure this generic event system scales for complex workflows, the following architectural enhancements should be considered during or immediately after the core implementation:

### 5.1 The Request-Response Gap (Correlation IDs)
**Why:** Without correlation IDs, if two concurrent `sendEvent` calls both expect a server reply (e.g., fetching stock price *and* weather at the same time), there's no way for the client to know which server reply belongs to which request.

**Example use case:** A financial dashboard widget fires:
```javascript
// These two responses need to be matched correctly on the client
const stockResult = await widget.sendEventAsync('get_stock_price', { ticker: 'AAPL' });
const weatherResult = await widget.sendEventAsync('get_weather', { city: 'London' });
```
`sendEventAsync` wraps the call with a UUID `request_id` and automatically resolves the right Promise when the server replies with the matching `reply_to_id`.

**Problem:** Currently, events are fire-and-forget. If the client requests data via an event, it has no way to deterministically map the server's asynchronous reply back to the original request (especially if multiple requests are flying concurrently).
**Implementation:**
1.  **Add `request_id`** to `ClientEventMessage`.
2.  **Add `reply_to_id`** to `ServerEventMessage`.
3.  **Client-Side Promise Wrapper:** Expose an `await widget.sendEventAsync(...)` method that generates a UUID, appends it to the `request_id`, stores a pending Promise in a map, and resolves it when a `ServerEventMessage` arrives with the matching `reply_to_id`.

### 5.2 Ephemeral vs. Permanent Rich Content (Statefulness)
**Why:** Some UI elements should update or disappear — not stack up forever in the chat scroll. For example, a "Processing your payment..." spinner should *replace itself* with a "Payment successful ✅" card when done.

**Example use case:**
1. Server pushes: `{ item_id: 'payment-status', action: 'append', type: 'spinner', payload: { text: 'Processing...' } }`
2. When the payment completes: `{ item_id: 'payment-status', action: 'replace', type: 'card', payload: { text: 'Payment successful ✅' } }`
The widget finds the original spinner DOM node by `item_id` and swaps it in-place.

**Problem:** The core design assumes all `rich_content` is permanently appended to the chat scroll. However, UI elements like a "live stock ticker", a "processing spinner", or an "upload progress bar" should update in place or vanish when completed to avoid clutter.
**Implementation:**
1.  Expand `RichContentItem` to include `item_id?: string` and `action?: 'append' | 'replace' | 'remove'`.
2.  **Client Handling:**
    *   `replace`: The widget searches the DOM for an existing rich content container with `data-id="{item_id}"` and replaces its inner HTML, rather than appending a new chat bubble.
    *   `remove`: The widget finds and deletes the specified DOM node.

### 5.3 Two-Way Interactive UI (Action Callbacks)
**Why:** The server can push a poll, an order confirmation form, or a "thumbs up / thumbs down" feedback card. But when the user clicks a button inside that card, the widget needs to route that interaction back to the AI automatically.

**Example use case:**
```javascript
// Registered renderer wires the onInteractiveAction callback
widget.registerRichRenderer('poll', (payload, container, _shadow, onInteractiveAction) => {
  payload.options.forEach(option => {
    const btn = document.createElement('button');
    btn.textContent = option;
    btn.onclick = () => onInteractiveAction('voted', { option });
    container.appendChild(btn);
  });
});
// When user clicks "Option A", the widget automatically sends:
// { name: 'interactive_component_action', data: { component_id: '...', action: 'voted', values: { option: 'A' } } }
```

**Problem:** The server can push a custom HTML form or a poll via `rich_content`, but how does the user's interaction (e.g., clicking a button inside that custom HTML) get communicated back to the AI?
**Implementation:**
1.  When the widget invoke a registered `RichContentRenderer`, it must pass down a standardized generic callback function, e.g., `onInteractiveAction(actionName: string, payload: any)`.
2.  The host site's custom renderer wires this callback to its internal DOM events (e.g., `<button onclick="onInteractiveAction('voted', {option: 'A'})">`).
3.  When triggered, the widget automatically formats and sends a standard `ClientEventMessage` behind the scenes:
    `{ type: 'client_event', name: 'interactive_component_action', data: { component_id: '...', action: 'voted', values: {...} }, directive: 'context' }`

### 5.4 Client Event Rate Limiting & Aggregation
**Why:** A `viewport_update` event tied to `window.scroll` fires hundreds of times per second. Without throttling, every scroll event floods both the WebSocket and the LLM's context window, degrading performance and burning tokens rapidly.

**Example use case:**
```javascript
// BAD — fires hundreds of events per second
window.addEventListener('scroll', () => widget.sendEvent('viewport_update', { y: window.scrollY }));

// GOOD — throttled version, max 1 event per 500ms
window.addEventListener('scroll', throttle(() => widget.sendEvent('viewport_update', { y: window.scrollY }), 500));
```
The Python server further applies state merging, keeping only the *latest* `viewport_update` in the LLM's context window at any given time.

**Problem:** High-frequency events (like a `viewport_update` tied to window scrolling) will flood the WebSocket and instantly consume the LLM's context window with redundant noise.
**Implementation:**
1.  **Client-side Throttling:** Add a `debounceMs` or `throttleMs` option to the public `widget.sendEvent()` API for host sites to utilize easily.
2.  **Server-side State Merging:** The Python server must intelligently aggregate noisy events instead of blindly appending all of them to the LLM history. For example, it should keep a single `"Last Known Viewport Context"` dictionary, overwriting older states, so the LLM is only fed the *latest* state just before generating its next response.

---

## 6. Automated Screen Context

The agent includes the ability to "See" what the user is looking at without requiring them to manually click an upload button.

### Example Usage and Rationale

**Why it was implemented:**
When a user struggles with a website (e.g., a confusing form or a dashboard), they might say "Why is this button red?" or "What does this chart mean?". Without visual context, the AI has perfectly blind spots. By allowing the AI to request a screen snapshot automatically, we enable it to provide hyper-contextual "See, Hear, Speak" support.

**How to use it:**
The user simply asks a visually-dependent question: "Can you help me fill out this form?". 
The AI recognizes it lacks context and invokes its `request_screen_context` tool. The widget intercepts this tool call natively, runs `html2canvas` invisibly in the background to capture a JPEG of the DOM, and immediately sends it back to the AI as a vision attachment.

### 6.1 Widget Implementation (`html2canvas`)

The widget utilizes a visual-capture technique to send DOM context to the agent on demand.
1. **The Tool (`request_screen_context`)**: A backend tool in the schemas called `request_screen_context`.
2. **The Execution**:
   - The widget's `ChatManager` listens for the `trigger_action` event of `request_screen_context`.
   - The widget dynamically captures the current viewport using `html2canvas(document.body)`.
   - `html2canvas` generates a Base64 image payload containing a snapshot of the UI.
   - The widget automatically sends this back to the server using the text communication channel with the newly established attachments array:
     ```javascript
     chatManager.sendTextMessage("Here is my current screen context.", [{
       mime_type: "image/jpeg",
       content: base64Data, // from html2canvas
       filename: "viewport.jpg"
     }]);
     ```

### 6.2 Security & Privacy

- **Data Masking**: Before `html2canvas` runs, the widget must obscure inputs matching `[type="password"]` and any elements decorated with a `data-private` attribute.
- **User Notification**: Flash a brief, non-intrusive toast notification in the widget UI: *"Nyx is analyzing your screen..."* to respect user privacy.

---

## 7. Interleaved Output Architecture

Modern Voice APIs (like Gemini Live and OpenAI Realtime) process function calls (tools) *concurrently* with audio streaming. The system leverages this to weave together text, imagery, and interactive UI blocks simultaneously.

### Example Usage and Rationale

**Why it was implemented:**
A purely conversational agent is great, but a *presenting* agent is better. We want the Avatar to act like a salesperson or a guide who points to visual aids while talking. If the AI talks for 10 seconds and *then* shows an image at the end, the experience feels disjointed. Interleaved Output ensures that visual elements appear inside the chat UI *exactly* on the syllable that the AI begins talking about them.

**How to use it:**
This is handled entirely by Prompt Engineering the AI backend. When a user asks "Show me your Enterprise features", the backend LLM is instructed to both begin streaming its audio response ("Our enterprise tier features robust security...") AND concurrently fire the `send_rich_content` tool. 
Because WebSockets are low latency, the user hears the audio stream begin at the precise moment the visual `enterprise_card` component renders on their screen.

### 7.1 Prompt Engineering for Tool Synchronization

The `send_rich_content` tool gives the AI the ability to project visuals. We instruct the LLM to use it *synchronously* with speech via the backend `assistant_instructions`:

```text
You are an immersive, multimodal assistant. When you describe a physical product, a complex concept, or a form, DO NOT just use your voice. 
You MUST concurrently call the `send_rich_content` tool to project an interactive visual or data payload onto the user's screen AT THE EXACT MOMENT you begin speaking about it.
```

### 7.2 Parallel Event Emitting
- When the LLM determines a tool call is necessary, it emits a `function_call` part.
- The Python server immediately routes this downstream via `trigger_action`.
- Due to the low-latency nature of the WebSocket, the `send_rich_content` payload hits the client widget's `registerRichRenderer` logic at essentially the same millisecond the audio stream describing it begins playing through the `AudioContext`.
- **Cross-Agent Support**: This event-driven architecture works identically for the `SampleOpenAIAgent`, `SampleGeminiAgent`, and `RemoteAgent`, as they all utilize the same asynchronous `_on_tool_call` callback in the backend router to push instructions downstream without blocking the voice loop.
