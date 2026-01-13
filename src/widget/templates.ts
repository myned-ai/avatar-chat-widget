/**
 * Widget HTML Templates
 * Clean design based on index.html
 */

export const WIDGET_TEMPLATE = `
<div class="widget-root">
  <!-- Avatar Circle - Breaking out at top -->
  <div class="avatar-circle" id="avatarCircle" aria-label="AI Avatar">
    <div class="avatar-placeholder">👤</div>
  </div>

  <div class="chat-header" role="button" tabindex="0" aria-label="Toggle chat window">
    <h3>Nyx Assistant</h3>
    <div class="chat-header-buttons">
      <button id="minimizeBtn" aria-label="Minimize chat" title="Minimize">−</button>
    </div>
  </div>

  <div id="chatMessages" class="messages-section" role="log" aria-live="polite" aria-atomic="false"></div>

  <div class="input-section">
    <input
      type="text"
      id="chatInput"
      class="chat-input"
      placeholder="Type a message..."
      aria-label="Chat message input"
      autocomplete="off"
    />
    <button
      id="micBtn"
      class="action-btn voice-btn"
      aria-label="Voice input"
      title="Voice input"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" x2="12" y1="19" y2="22"/>
      </svg>
    </button>
    <button
      id="sendBtn"
      class="action-btn send-btn"
      aria-label="Send message"
      title="Send"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 2 11 13"/>
        <path d="M22 2 15 22 11 13 2 9 22 2z"/>
      </svg>
    </button>
  </div>
</div>
`;

export const BUBBLE_TEMPLATE = `
<div class="chat-bubble" role="button" aria-label="Open chat" tabindex="0">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
</div>
`;
