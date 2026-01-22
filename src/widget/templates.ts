/**
 * Widget HTML Templates
 */

export const WIDGET_TEMPLATE = `
<div class="widget-root">
  <!-- Immersive Avatar Stage (Top 55%) -->
  <div class="avatar-stage" id="avatarContainer" aria-label="AI Avatar Scene">
    <!-- Header Overlay -->
    <div class="chat-header-overlay">
      <div class="header-info">
        <h3>Nyx Assistant</h3>
        <span class="status-badge">Live</span>
      </div>
      <div class="chat-header-buttons">
        <button id="minimizeBtn" class="control-btn" aria-label="Minimize chat" title="Minimize">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>
    
    <!-- Avatar Canvas gets injected here by code -->
    <div class="avatar-placeholder"></div>
  </div>

  <!-- Chat Interface (Bottom 45%) -->
  <div class="chat-interface">
    <div class="chat-messages" id="chatMessages" role="log" aria-live="polite">
      <!-- Messages injected here -->
      <div id="typingIndicator" class="message assistant typing-indicator hidden">
        <div class="message-bubble">
           <div class="typing-dots">
             <span></span><span></span><span></span>
           </div>
        </div>
      </div>
    </div>

    <!-- Quick Replies -->
    <div class="quick-replies" id="quickReplies">
      <!-- Chips injected here via JS -->
      <button class="suggestion-chip">What is your story?</button>
      <button class="suggestion-chip">What services do you provide?</button>
      <button class="suggestion-chip">Can I book a meeting?</button>
    </div>

    <div class="chat-input-area">
       <div class="chat-input-wrapper">
         <div class="chat-input-controls">
            <input type="text" id="chatInput" placeholder="Ask me anything..." aria-label="Message input" autocomplete="off" />
             
             <!-- Mic Button (Prominent) -->
             <button id="micBtn" class="input-button" aria-label="Voice input">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" x2="12" y1="19" y2="22"/>
                </svg>
             </button>
             
             <!-- Send Button -->
             <button id="sendBtn" class="input-button" aria-label="Send message">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 2 11 13"/>
                  <path d="M22 2 15 22 11 13 2 9 22 2z"/>
                </svg>
             </button>
         </div>
      </div>
      <div class="branding">Powered by <a href="https://www.myned.ai" target="_blank" rel="noopener noreferrer">Myned AI</a></div>
    </div>
  </div>
</div>
`;

export const BUBBLE_TEMPLATE = `
<div class="bubble-container">
  <div class="bubble-tooltip-wrapper">
     <div class="bubble-tooltip" id="bubbleTooltip">
        <span class="tooltip-text">Hi! 👋 Ask me anything about Myned AI.</span>
        <button class="tooltip-close" id="tooltipClose" aria-label="Close tooltip">×</button>
     </div>
  </div>
  <div class="chat-bubble" id="chatBubble" role="button" aria-label="Open chat" tabindex="0">
    <div class="bubble-avatar-preview">
      <img src="./asset/avatar.png" class="avatar-face-img" alt="Nyx Avatar" />
      <div class="status-dot"></div>
    </div>
  </div>
</div>
`;
