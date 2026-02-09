/**
 * Widget Styles
 */

const CSS_RESET = `
/* System font stack for CSP compliance */
:host {
  all: initial;
  display: block;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
  color: #1F2937;
  box-sizing: border-box;

  /* Theme Variables */
  --primary-color: #4B4ACF;
  --primary-gradient: linear-gradient(135deg, #4B4ACF 0%, #2E3A87 100%);
  --secondary-color: #1F2937;
  --bg-color: #ffffff;
  --text-color: #1F2937;
  --text-muted: #9ca3af;
  --input-bg: #f5f5f7;
  --border-color: #e0e0e0;

  /* Dimensions */
  --header-height: 56px; 
  --input-height: 90px;
  --widget-width: 350px;
  --border-radius-large: 20px;
  
  /* Dynamic Heights */
  --widget-height: 370px;
  --avatar-height: 280px;  /* avatar-focus default */
  --chat-height: 0px;      /* avatar-focus default */
  
  /* Animation */
  --transition-duration: 300ms;
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-smooth: cubic-bezier(0.19, 1, 0.22, 1);
}

:host * {
  box-sizing: inherit;
}

/* Position variants */
:host(.position-bottom-right) { position: fixed; bottom: 20px; right: 20px; z-index: 999999; }
:host(.position-bottom-left) { position: fixed; bottom: 20px; left: 20px; z-index: 999999; }
:host(.position-top-right) { position: fixed; top: 20px; right: 20px; z-index: 999999; }
:host(.position-top-left) { position: fixed; top: 20px; left: 20px; z-index: 999999; }
:host(.position-inline) { position: relative; }
:host(.hidden) { display: none !important; }

/* Accessibility */
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
`;

const LAYOUT_STYLES = `
/* Main Container - Flex Column Layout */
.widget-root {
  width: var(--widget-width);
  height: var(--widget-height);
  max-height: 80vh;
  position: relative;
  display: flex;
  flex-direction: column;
  padding-bottom: var(--input-height); /* Reserve space for absolutely positioned input */
  background: var(--bg-color);
  border-radius: var(--border-radius-large);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12), 0 4px 8px rgba(0, 0, 0, 0.05);
  overflow: hidden;
  border: 1px solid rgba(0,0,0,0.08);
  transition: height var(--transition-duration) var(--ease-spring);
}

/* Position fixes for absolute containers */
:host(.position-bottom-right) .widget-root,
:host(.position-bottom-left) .widget-root,
:host(.position-top-right) .widget-root,
:host(.position-top-left) .widget-root {
  position: absolute;
  bottom: 0;
  right: 0;
}

.widget-root.minimized {
  transform: translateY(20px) scale(0.9);
  opacity: 0;
  pointer-events: none;
  transition: transform 0.3s var(--ease-smooth), opacity 0.3s ease;
}

/* Expanded state - larger widget */
.widget-root.expanded {
  width: 500px;
  height: 600px !important; /* TODO: Remove !important via prop update */
  --widget-height: 600px;
}

/* Text-focus overflow overrides */
[data-drawer-state="text-focus"].widget-root {
  overflow: visible;
  border-radius: var(--border-radius-large);
}
`;

const HEADER_STYLES = `
/* Header Layer (Fixed Height) */
.header-layer {
  height: var(--header-height) !important;
  min-height: var(--header-height) !important;
  max-height: var(--header-height) !important;
  flex-shrink: 0;
  padding: 8px 16px 16px 12px; /* Reduced left padding to pull title left */
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: transparent;
  z-index: 10;
  position: relative;
  transition: background 0.3s ease;
}

/* Header States */
[data-drawer-state="avatar-focus"] .header-layer {
  background: transparent !important;
}

[data-drawer-state="text-focus"] .header-layer {
  background: var(--bg-color);
  height: var(--header-height) !important;
  min-height: var(--header-height) !important;
  max-height: var(--header-height) !important;
  padding-left: 90px; /* Indent for avatar orbit */
  overflow: visible;
  border-top-left-radius: var(--border-radius-large);
  border-top-right-radius: var(--border-radius-large);
  align-items: center;
}

/* Content */
.header-info {
  display: flex;
  flex-direction: column;
  flex: 1;
}

[data-drawer-state="text-focus"] .header-info {
  text-align: center;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

[data-drawer-state="text-focus"] .header-title {
  justify-content: center;
}

.header-info h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--secondary-color);
  letter-spacing: -0.01em;
}

/* Buttons */
.header-buttons {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  height: 28px; /* Fixed height for consistent alignment */
}

/* Tighter spacing in text-focus mode */
[data-drawer-state="text-focus"] .header-buttons {
  gap: 0px;
}

[data-drawer-state="text-focus"] .control-btn {
  width: 26px; /* Reduced width + gap 0 = tighter icons */
}


.control-btn {
  background: transparent;
  border: none;
  color: var(--secondary-color);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 500;
}

.control-btn svg {
  width: 18px;
  height: 18px;
  stroke-width: 2.5;
}

.control-btn:hover {
  background: rgba(0, 0, 0, 0.08);
}

/* View Mode Toggle Button */
#viewModeBtn .text-mode-icon { display: block; }
#viewModeBtn .avatar-mode-icon { display: none; }
[data-drawer-state="text-focus"] #viewModeBtn .text-mode-icon { display: none; }
[data-drawer-state="text-focus"] #viewModeBtn .avatar-mode-icon { display: block; }

/* Expand Button Visibility */
.expand-btn { display: flex; }
.expand-btn .collapse-icon { display: none; }
[data-drawer-state="avatar-focus"] .expand-btn { display: none; }

.widget-root.expanded .expand-btn .expand-icon { display: none; }
.widget-root.expanded .expand-btn .collapse-icon { display: block; }
`;

const AVATAR_STYLES = `
/* Avatar Section (Variable Height) */
.avatar-section {
  height: var(--avatar-height);
  min-height: 0;
  flex-shrink: 0;
  position: relative;
  overflow: visible;
  margin-top: calc(var(--header-height) * -1); /* Pull up behind header */
  padding-top: var(--header-height);
  transition: height var(--transition-duration) var(--ease-spring);
}

.avatar-stage {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: radial-gradient(circle at center 40%, #f0f4ff 0%, #ffffff 80%);
  overflow: hidden;
}

/* Avatar Canvas Container */
.avatar-render-container {
  width: 800px;
  height: 800px;
  position: absolute;
  top: 48%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.70);
  transform-origin: center center;
  pointer-events: none;
  z-index: 5;
}

.avatar-render-container canvas {
  width: 100% !important;
  height: 100% !important;
  object-fit: contain;
}

[data-drawer-state="avatar-focus"] .avatar-render-container {
  top: 45%;
}

/* Avatar Mist Overlay */
.avatar-mist-overlay {
  position: absolute;
  bottom: -40px;
  left: 0;
  width: 100%;
  height: 140px;
  background: linear-gradient(to bottom, 
    rgba(255, 255, 255, 0) 0%, 
    rgba(255, 255, 255, 0.7) 45%,
    rgba(255, 255, 255, 0.9) 70%,
    #FFFFFF 100%
  );
  z-index: 10;
  pointer-events: none;
  display: none;
}

[data-drawer-state="avatar-focus"] .avatar-mist-overlay {
  display: block;
}

/* Text-Focus Mode Transformations (Mascot Orb) */
[data-drawer-state="text-focus"] .avatar-section {
  position: absolute;
  left: -25px;
  top: -6px;
  transform: none;
  width: 90px;
  height: 90px;
  border-radius: 50%;
  overflow: visible;
  z-index: 100;
  background: white;
  border: 4px solid #FFFFFF;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  margin-top: 0;
  padding-top: 0; /* Reset compensation padding */
  transition: none;
}

[data-drawer-state="text-focus"] .avatar-stage {
  border-radius: 50%;
  background: white;
}

[data-drawer-state="text-focus"] .avatar-render-container {
  top: 58%;
  transform: translate(-50%, -50%) scale(0.24); /* Zoomed out for orb */
}
`;

const OVERLAY_UI_STYLES = `
/* Subtitles */
.avatar-subtitles {
  display: none;
  position: absolute;
  bottom: 0px;
  left: 0; right: 0;
  margin: 0 auto;
  text-align: center;
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  background: transparent;
  padding: 0 16px;
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);
  z-index: 25;
  max-width: 320px;
  width: fit-content;
  white-space: nowrap;
  overflow: hidden;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.avatar-subtitles.visible {
  animation: subtitleFadeIn 0.3s ease forwards;
}

[data-drawer-state="avatar-focus"] .avatar-subtitles {
  display: block;
}

[data-drawer-state="avatar-focus"] .avatar-subtitles:not(:empty) {
  opacity: 1;
}

.avatar-subtitles:empty {
  opacity: 0 !important;
  pointer-events: none;
}

.avatar-subtitles.user-speaking { color: var(--primary-color); }
.avatar-subtitles .subtitle-current { color: var(--primary-color); font-weight: 600; }

/* Suggestions */
.avatar-suggestions {
  display: none; /* Flex when active */
  position: absolute;
  bottom: 6px;
  left: 50%;
  transform: translateX(-50%);
  width: 90%;
  max-width: 320px;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 4px;
  padding: 4px;
  z-index: 15;
}

[data-drawer-state="avatar-focus"] .avatar-suggestions {
  display: flex;
}

.widget-root.has-messages .avatar-suggestions {
  display: none !important;
}

.suggestion-chip {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid var(--border-color);
  color: var(--primary-color);
  padding: 6px 10px;
  border-radius: 16px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  backdrop-filter: blur(8px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.suggestion-chip:hover {
  background: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(75, 74, 207, 0.25);
}
`;

const CHAT_STYLES = `
/* Chat Section */
.chat-section {
  height: var(--chat-height);
  min-height: 0;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  background: var(--bg-color);
  z-index: 5;
  transition: height var(--transition-duration) var(--ease-spring);
}

/* Gradient fade at top */
.chat-section::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 30px;
  background: linear-gradient(to bottom, var(--bg-color) 0%, transparent 100%);
  pointer-events: none;
  z-index: 10;
}

[data-drawer-state="text-focus"] .chat-section {
  margin-top: 0;
}

/* Expanded State Logic */
.widget-root.expanded[data-drawer-state="text-focus"] {
  --chat-height: 454px;
}
.widget-root.expanded[data-drawer-state="text-focus"] .chat-section {
  height: var(--chat-height);
}

/* Messages */
.chat-messages {
  flex: 1;
  padding: 12px 16px 4px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

[data-drawer-state="text-focus"] .chat-messages {
  padding-top: 20px;
}

.widget-root.has-messages .chat-messages {
  opacity: 1;
  pointer-events: auto;
}

/* Scrollbar hover effect */
.chat-messages:hover { scrollbar-color: rgba(0,0,0,0.15) transparent; }

.chat-messages::-webkit-scrollbar { width: 3px; }
.chat-messages::-webkit-scrollbar-track { background: transparent; }
.chat-messages::-webkit-scrollbar-thumb { background-color: transparent; border-radius: 3px; }
.chat-messages:hover::-webkit-scrollbar-thumb { background-color: rgba(0,0,0,0.15); }

/* Quick Replies (Empty State) */
.quick-replies {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 10px;
  padding: 12px 16px 24px 16px;
  transition: opacity 0.2s ease;
}

.quick-replies.hidden {
  opacity: 0;
  pointer-events: none;
}

.quick-replies .suggestion-chip {
  background: var(--input-bg);
  backdrop-filter: none;
  padding: 7px 12px;
  font-size: 11px;
  box-shadow: none;
}

.quick-replies .suggestion-chip:hover {
  background: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
}

/* Message Bubbles */
.message {
  display: flex;
  flex-direction: column;
  animation: slideUp 0.3s ease;
  max-width: 85%;
  margin-bottom: 4px;
}

.message.user { align-self: flex-end; align-items: flex-end; }
.message.assistant { align-self: flex-start; align-items: stretch; }

.message-bubble {
  padding: 10px 16px;
  border-radius: 18px;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.6;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}

.message.user .message-bubble {
  background: var(--primary-color);
  color: white;
  border-bottom-right-radius: 4px;
}

.message.assistant .message-bubble {
  background: #FFFFFF;
  color: #374151;
  border-bottom-left-radius: 4px;
  border: 1px solid #F3F4F6;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}

.message-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
  padding: 0 4px;
  min-height: 20px;
}

.message-time { font-size: 11px; color: var(--text-muted); }

/* Typing Indicator */
.typing-indicator {
  display: none;
  position: absolute;
  bottom: 8px; left: 16px;
  padding: 6px 12px;
  background: var(--input-bg);
  border-radius: 12px;
  z-index: 10;
}
.typing-indicator.visible { display: flex; }

.typing-dots { display: flex; gap: 4px; padding: 4px 2px; }
.typing-dots span {
  width: 6px; height: 6px;
  background: #6b7280;
  border-radius: 50%;
  animation: typingBounce 1.4s infinite ease-in-out both;
}
.typing-dots span:nth-child(1) { animation-delay: -0.32s; }
.typing-dots span:nth-child(2) { animation-delay: -0.16s; }
`;

const INPUT_STYLES = `
/* Input Layer (Fixed Height) */
.input-layer {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: var(--input-height) !important;
  min-height: var(--input-height) !important;
  max-height: var(--input-height) !important;
  background: var(--bg-color);
  z-index: 100;
}

/* Curved corners in text focus */
[data-drawer-state="text-focus"] .input-layer,
[data-drawer-state="text-focus"] .chat-input-area {
  border-bottom-left-radius: var(--border-radius-large);
  border-bottom-right-radius: var(--border-radius-large);
}

/* Input Gradient Overlay */
[data-drawer-state="text-focus"] .input-layer::before {
  content: '';
  position: absolute;
  top: -20px; left: 0; right: 0;
  height: 20px;
  background: linear-gradient(to top, var(--bg-color) 0%, transparent 100%);
  pointer-events: none;
}

.chat-input-area {
  padding: 16px;
  background: var(--bg-color);
  flex-shrink: 0;
}

.chat-input-wrapper { margin-bottom: 8px; }

.chat-input-controls {
  display: flex;
  gap: 10px;
  align-items: center;
  flex: 1;
}

.chat-input-controls #micBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  width: 40px; height: 40px;
  color: var(--secondary-color);
  margin-left: 4px;
}
.chat-input-controls #micBtn:hover {
  background: #f3f4f6;
  color: var(--primary-color);
  transform: scale(1.05);
}

#chatInput {
  flex: 1;
  padding: 12px 16px;
  border-radius: 24px;
  border: 1px solid var(--border-color);
  background: var(--input-bg);
  color: var(--text-color);
  outline: none;
  font-family: inherit;
  transition: box-shadow 0.2s;
}

#chatInput:focus {
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
  border-color: var(--primary-color);
}

.input-button {
  background: transparent;
  color: var(--text-muted);
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 50%;
  transition: all 0.2s;
  font-weight: 500;
}

.input-button:hover {
  background: var(--input-bg);
  color: var(--primary-color);
}

.input-button.recording {
  color: #e74c3c !important;
  background: rgba(231, 76, 60, 0.1);
  animation: recordPulse 1.5s infinite;
}

.branding {
  text-align: center;
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 4px;
}
.branding a { color: #7986cb; text-decoration: none; }
.branding a:hover { text-decoration: underline; }
`;

const LAUNCHER_STYLES = `
/* Launcher Bubble */
:host(.collapsed) {
  width: auto !important; height: auto !important;
  bottom: 20px !important; right: 20px !important;
  top: auto !important; left: auto !important;
  background: transparent !important;
  box-shadow: none !important;
}

.bubble-container {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.chat-bubble {
  width: 64px; height: 64px;
  border-radius: 50%;
  background: var(--bg-color);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  position: relative;
  transition: transform 0.3s var(--ease-spring);
  z-index: 20;
}

.chat-bubble:hover { transform: scale(1.1); }

.bubble-avatar-preview {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  background: white;
  border-radius: 50%;
  overflow: hidden;
}

.avatar-face-img, .avatar-fallback-icon {
  width: 100%; height: 100%;
}
.avatar-face-img { object-fit: cover; }
.avatar-fallback-icon {
  display: flex; align-items: center; justify-content: center;
  background: var(--primary-gradient);
  color: white;
}

.bubble-avatar-preview .status-dot {
  position: absolute; bottom: 0; right: 0;
  width: 14px; height: 14px;
  background: #10b981;
  border: 2px solid white;
  border-radius: 50%;
  z-index: 5;
}

/* Tooltip */
.bubble-tooltip-wrapper {
  position: absolute;
  right: 74px; top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  width: max-content; /* Allow natural width */
  max-width: 240px;
  display: flex;
  justify-content: flex-end;
}

.bubble-tooltip {
  pointer-events: auto;
  background: white;
  color: #333;
  padding: 10px 14px;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 10px;
  opacity: 0;
  transform: translateX(10px);
  animation: tooltipSlideIn 0.5s var(--ease-smooth) 1.5s forwards;
  position: relative;
}

.bubble-tooltip.hidden { display: none; }

.bubble-tooltip::after {
  content: '';
  position: absolute;
  right: -6px; top: 50%;
  width: 12px; height: 12px;
  background: white;
  transform: translateY(-50%) rotate(45deg);
}

.tooltip-close {
  background: none; border: none;
  color: var(--text-muted);
  cursor: pointer;
  width: 20px; height: 20px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.tooltip-close:hover { background: var(--input-bg); color: var(--text-color); }
`;

const ANIMATIONS = `
@keyframes subtitleFadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes typingBounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes popIn {
  from { transform: scale(0); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

@keyframes recordPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

@keyframes tooltipSlideIn {
  to { opacity: 1; transform: translateX(0); }
}
`;

const MOBILE_STYLES = `
/* Mobile Overrides (Consolidated) */
@media (max-width: 480px) {
  /* Prevent iOS Zoom on Input */
  #chatInput { font-size: 16px !important; }

  :host(:not(.collapsed)),
  .widget-root {
    width: 100% !important;
    height: 100% !important;
    max-width: none !important;
    max-height: 100dvh !important;
    border-radius: 0 !important;
    top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
    position: fixed !important;
  }

  :host(:not(.collapsed)) .widget-root {
    border: none !important;
    padding-bottom: var(--input-height);
  }

  /* Dynamic viewport sizes */
  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] {
    --avatar-height: calc(100dvh - var(--header-height) - var(--input-height)) !important;
    background: transparent !important;
  }
  
  /* Make header bigger on mobile */
  :host(:not(.collapsed)) .chat-header-overlay { padding: 12px 16px; }
  
  /* Disable expanded state */
  :host(:not(.collapsed)) .widget-root.expanded { width: 100% !important; height: 100% !important; }
  .expand-btn { display: none !important; }

  /* Adjustments for Avatar Focus */
  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] .avatar-section {
    height: 100% !important;
    width: 100% !important;
    margin-top: 0 !important;
    padding-top: 0 !important;
    position: absolute;
    top: 0; bottom: var(--input-height);
  }
  
  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] .avatar-render-container {
    transform: translate(-50%, -50%) scale(0.85); /* Larger on mobile */
  }

  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] .header-layer {
    background: var(--bg-color) !important;
  }

  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] .avatar-stage {
    background: var(--bg-color) !important;
  }

  /* Adjustments for Text Focus */
  :host(:not(.collapsed)) [data-drawer-state="text-focus"] {
    --chat-height: calc(100dvh - var(--header-height) - var(--input-height)) !important;
  }

  /* Resize avatar circle for mobile */
  :host(:not(.collapsed)) [data-drawer-state="text-focus"] .avatar-section {
    left: 12px; top: 12px; /* Better alignment */
    width: 50px; height: 50px; /* Smaller distinct circle */
    border-width: 2px;
  }
  
  :host(:not(.collapsed)) [data-drawer-state="text-focus"] .header-layer {
    padding-left: 72px; /* 12px + 50px + 10px */
  }

  :host(:not(.collapsed)) [data-drawer-state="text-focus"] .avatar-render-container {
    top: 58% !important; /* Move up for better centering */
    transform: translate(-50%, -50%) scale(0.16);
  }

  /* Restore header button sizes in text mode on mobile */
  :host(:not(.collapsed)) [data-drawer-state="text-focus"] .control-btn {
    width: 28px !important;
  }
  
  :host(:not(.collapsed)) [data-drawer-state="text-focus"] .header-buttons {
    gap: 2px !important;
  }
  
  /* Suggestions & Mist */
  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] .avatar-mist-overlay {
    display: block;
    bottom: 0;
    height: 35vh;
  }

  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] .avatar-suggestions {
    bottom: 110px; 
    width: 95%;
    max-width: none;
    gap: 6px;
    padding: 4px;
    transition: opacity 0.2s ease;
  }

  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] .avatar-subtitles {
    display: block;
    bottom: 100px;
    max-width: 90%;
    width: auto;
    font-size: 15px;
    white-space: normal;
    padding: 0 20px;
  }

  /* Keyboard Visible / Input Focus State */
  /* This ensures styles apply when keyboard is up or user is typing */
  .widget-root.keyboard-visible {
    --avatar-height: var(--keyboard-available-height, 180px);
  }
  .widget-root.input-focused {
    --avatar-height: 180px; 
  }

  /* Hide mist overlay during typing to clear view */
  .widget-root.keyboard-visible .avatar-mist-overlay,
  .widget-root.input-focused .avatar-mist-overlay {
    display: none !important;
  }

  /* Move avatar to stay visible just above input when keyboard is open */
  .widget-root.keyboard-visible[data-drawer-state="avatar-focus"] .avatar-render-container {
    transform: translate(-50%, -12%) scale(0.50) !important;
    transition: transform 0.3s var(--ease-spring);
  }
  .widget-root.input-focused[data-drawer-state="avatar-focus"] .avatar-render-container { 
    transform: translate(-50%, -40%) scale(0.55) !important; 
    transition: transform 0.3s var(--ease-spring);
  }

  /* Text-focus mode: move avatar orb just above input when keyboard is visible */
  .widget-root.keyboard-visible[data-drawer-state="text-focus"] .avatar-section {
    top: auto !important;
    bottom: calc(var(--input-height) + 25px) !important;
    left: 12px !important;
    transform: none;
  }

  /* Text-focus mode: move quick replies to bottom near avatar orb when keyboard is visible */
  .widget-root.keyboard-visible[data-drawer-state="text-focus"] .quick-replies {
    justify-content: flex-end;
    padding-bottom: 64px;
  }

  /* Text-mode: match avatar-mode pill style (white with shadow) on mobile */
  .quick-replies .suggestion-chip {
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(8px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
}
`;

export const WIDGET_STYLES = `
  ${CSS_RESET}
  ${LAYOUT_STYLES}
  ${HEADER_STYLES}
  ${AVATAR_STYLES}
  ${OVERLAY_UI_STYLES}
  ${CHAT_STYLES}
  ${INPUT_STYLES}
  ${LAUNCHER_STYLES}
  ${ANIMATIONS}
  ${MOBILE_STYLES}
`;
