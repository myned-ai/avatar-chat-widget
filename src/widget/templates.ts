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
<div class="widget-root" data-drawer-state="split-view">
  <!-- Header (fixed height, always visible) -->
  <div class="header-layer">
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
      <!-- View Mode Selector -->
      <div class="view-mode-wrapper">
        <button id="viewModeBtn" class="control-btn" aria-label="Change view mode" title="View mode" aria-haspopup="true" aria-expanded="false">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
        <div class="view-mode-dropdown" id="viewModeDropdown">
          <button class="view-mode-option" data-mode="avatar-focus">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="8" r="5"></circle>
              <path d="M20 21a8 8 0 1 0-16 0"></path>
            </svg>
            <span>Avatar</span>
          </button>
          <button class="view-mode-option active" data-mode="split-view">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"></rect>
              <line x1="3" y1="12" x2="21" y2="12"></line>
            </svg>
            <span>Split</span>
          </button>
          <button class="view-mode-option" data-mode="text-focus">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="17" y1="10" x2="3" y2="10"></line>
              <line x1="21" y1="6" x2="3" y2="6"></line>
              <line x1="21" y1="14" x2="3" y2="14"></line>
              <line x1="17" y1="18" x2="3" y2="18"></line>
            </svg>
            <span>Text</span>
          </button>
        </div>
      </div>
      <button id="minimizeBtn" class="control-btn" aria-label="Minimize chat" title="Minimize">
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
      <img src="./asset/avatar.gif" class="avatar-face-img" alt="Nyx Avatar" />
      <div class="status-dot"></div>
    </div>
  </div>
</div>
`;
