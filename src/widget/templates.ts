/**
 * Widget HTML Templates
 * 
 * Push Drawer Layout (vertical flex):
 * - Header (fixed 56px)
 * - Avatar Section (variable, controlled by --avatar-height)
 * - Section Divider (1px, only visible in text-focus)
 * - Chat Section (variable, controlled by --chat-height)
 * - Input Layer (fixed 90px, absolutely positioned)
 */

export const WIDGET_TEMPLATE = `
<div class="widget-root" data-drawer-state="avatar-focus">
  <!-- Header (fixed height, always visible) -->
  <div class="header-layer">
    <!-- Header Info -->

    <div class="header-info">
      <div class="header-title">
        <span class="status-dot"></span>
        <h3>Nyx Assistant</h3>
      </div>
    </div>
    <div class="header-buttons">
      <!-- Expand Button (only visible in text-focus) -->
      <button id="expandBtn" class="control-btn expand-btn" aria-label="Expand chat" title="Expand">
        <svg class="expand-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 3 21 3 21 9"></polyline>
          <polyline points="9 21 3 21 3 15"></polyline>
          <line x1="21" y1="3" x2="14" y2="10"></line>
          <line x1="3" y1="21" x2="10" y2="14"></line>
        </svg>
        <svg class="collapse-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 14 10 14 10 20"></polyline>
          <polyline points="20 10 14 10 14 4"></polyline>
          <line x1="14" y1="10" x2="21" y2="3"></line>
          <line x1="3" y1="21" x2="10" y2="14"></line>
        </svg>
      </button>
      <!-- View Mode Toggle Button -->
      <button id="viewModeBtn" class="control-btn" aria-label="Toggle view mode" title="Chat View">
        <!-- Chat bubble icon (shown in avatar-focus mode) -->
        <svg class="text-mode-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <!-- Video camera icon (shown in text-focus mode) -->
        <svg class="avatar-mode-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="6" width="14" height="12" rx="2" ry="2"></rect>
          <polygon points="23 8 16 12 23 16 23 8"></polygon>
        </svg>
      </button>
      <button id="minimizeBtn" class="control-btn" aria-label="Close" title="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  </div>

  <!-- Avatar Section (variable height) -->
  <div class="avatar-section" id="avatarSection">
    <div class="avatar-stage" id="avatarContainer" aria-label="AI Avatar Scene">
      <!-- Avatar Canvas gets injected here by code -->
      <div class="avatar-placeholder"></div>
    </div>
    <!-- White Mist Overlay - hides messy splat edges permanently -->
    <div class="avatar-mist-overlay" aria-hidden="true"></div>
    <!-- Subtitles (only visible in avatar-focus mode) - floats in the mist -->
    <div class="avatar-subtitles" id="avatarSubtitles" aria-live="polite"></div>
    <!-- Avatar Suggestions (only visible in avatar-focus mode) -->
    <div class="avatar-suggestions" id="avatarSuggestions">
      <!-- Chips injected dynamically from config.suggestions -->
    </div>
  </div>

  <!-- Divider between avatar and chat -->
  <div class="section-divider" id="sectionDivider"></div>

  <!-- Chat Section (variable height, hidden in avatar-focus) -->
  <div class="chat-section" id="chatSection">
    <div class="chat-messages" id="chatMessages" role="log" aria-live="polite">
      <!-- Messages injected here -->
    </div>
    
    <!-- Typing indicator -->
    <div id="typingIndicator" class="typing-indicator">
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
    </div>

    <!-- Quick Replies -->
    <div class="quick-replies" id="quickReplies">
      <!-- Chips injected dynamically from config.suggestions -->
    </div>
  </div>

  <!-- Input Layer (fixed height, always visible) -->
  <div class="input-layer">
    <div class="chat-input-area">
       <div class="chat-input-wrapper">
         <div class="chat-input-controls">
            <input type="text" id="chatInput" placeholder="Ask me anything..." aria-label="Message input" autocomplete="off" />
             
             <!-- Mic Button (Prominent) -->
             <button type="button" id="micBtn" class="input-button" aria-label="Voice input" title="Voice Input">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" x2="12" y1="19" y2="22"/>
                </svg>
             </button>
         </div>
      </div>
      <div class="branding">Designed by <a href="https://www.myned.ai" target="_blank" rel="noopener noreferrer">Myned AI</a></div>
    </div>
  </div>
</div>
`;

export const BUBBLE_TEMPLATE = `
<div class="bubble-container">
  <div class="bubble-tooltip-wrapper">
     <div class="bubble-tooltip" id="bubbleTooltip">
        <span class="tooltip-text" id="tooltipText"></span>
        <button class="tooltip-close" id="tooltipClose" aria-label="Close tooltip">×</button>
     </div>
  </div>
  <div class="chat-bubble" id="chatBubble" role="button" aria-label="Open chat" tabindex="0">
    <div class="bubble-avatar-preview">
      <img src="./asset/avatar.gif" class="avatar-face-img" alt="Nyx Avatar" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
      <div class="avatar-fallback-icon" style="display:none;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      </div>
      <div class="status-dot"></div>
    </div>
  </div>
</div>
`;
