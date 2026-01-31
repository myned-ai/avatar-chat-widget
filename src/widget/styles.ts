/**
 * Widget Styles
 * Push Drawer Layout (2026 Redesign)
 * 
 * Vertical flex layout:
 * - Header (fixed 56px)
 * - Avatar Section (variable, controlled by --avatar-height)
 * - Handle (fixed 24px)
 * - Chat Section (variable, controlled by --chat-height)
 * - Input Layer (fixed 90px)
 */

export const WIDGET_STYLES = `
/* Import Inter font */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap');

/* Reset all inherited styles */
:host {
  all: initial;
  display: block;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.5;
  color: #1F2937;
  box-sizing: border-box;
  --primary-color: #4B4ACF;
  --primary-gradient: linear-gradient(135deg, #4B4ACF 0%, #2E3A87 100%);
  --bg-color: #ffffff;
  --text-color: #1F2937;
  --input-bg: #f5f5f7;
  --border-color: #e0e0e0;
  /* Heights - avatar-focus default: avatar 316px (includes 56px behind header) */
  --widget-height: 406px;
  --avatar-height: 316px;  /* avatar-focus default: 260 + 56 padding */
  --chat-height: 0px;      /* avatar-focus default: no chat */
  --transition-duration: 300ms;
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

/* ==========================================================================
   Main Container - Flex Column Layout
   ========================================================================== */
.widget-root {
  width: 350px;
  height: var(--widget-height);
  max-height: 80vh;
  position: relative; /* For absolute positioned input layer */
  display: flex;
  flex-direction: column;
  padding-bottom: 90px; /* Reserve space for absolutely positioned input */
  background: var(--bg-color);
  border-radius: 20px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12), 0 4px 8px rgba(0, 0, 0, 0.05);
  overflow: hidden;
  border: 1px solid rgba(0,0,0,0.08);
  transition: height var(--transition-duration) cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* Position the widget at bottom-right of host */
:host(.position-bottom-right) .widget-root,
:host(.position-bottom-left) .widget-root,
:host(.position-top-right) .widget-root,
:host(.position-top-left) .widget-root {
  position: absolute;
  bottom: 0;
  right: 0;
}

@media (max-width: 480px) {
  .widget-root {
    width: 100vw;
    height: 100vh;
    max-height: 100vh;
    border-radius: 0;
  }
}

.widget-root.minimized {
  transform: translateY(20px) scale(0.9);
  opacity: 0;
  pointer-events: none;
  transition: transform 0.3s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.3s ease;
}

.widget-root.theme-dark {
  --bg-color: #0f111a;
  --text-color: #ffffff;
  --input-bg: #1e2130;
  --border-color: #2a2e42;
  color: white;
}

/* ==========================================================================
   Header Layer (Fixed Height: 56px - NEVER changes)
   ========================================================================== */
.header-layer {
  height: 56px !important;
  min-height: 56px !important;
  max-height: 56px !important;
  flex-shrink: 0;
  flex-grow: 0;
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  /* Default: transparent when avatar is visible */
  background: transparent;
  z-index: 10;
  position: relative;
  transition: background 0.3s ease;
}

/* Solid header when text-focus (avatar collapsed) */
[data-drawer-state="text-focus"] .header-layer {
  background: var(--bg-color);
  padding-left: 80px; /* More room for avatar circle */
  overflow: visible; /* Allow avatar to overflow */
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
}

/* Allow avatar circle to break out of widget in text-focus */
[data-drawer-state="text-focus"].widget-root {
  overflow: visible;
  border-radius: 20px; /* Preserve rounded corners */
}

/* ==========================================================================
   Header Avatar Circle (visible only in text-focus mode)
   ========================================================================== */
/* Header avatar circle - no longer used, avatar section is repositioned instead */
.header-avatar-circle {
  display: none;
}

.header-avatar-inner {
  display: none;
}

.header-info {
  display: flex;
  flex-direction: column;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-title .status-dot {
  width: 8px;
  height: 8px;
  background-color: #10b981;
  border-radius: 50%;
  box-shadow: 0 0 6px #10b981;
  flex-shrink: 0;
}

.header-info h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-color);
  letter-spacing: -0.01em;
}

.theme-dark .header-info h3 {
  color: white;
}

.header-buttons {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Expand button - visible in text-focus, hidden in avatar-focus */
.expand-btn {
  display: flex;
}

.expand-btn .collapse-icon {
  display: none;
}

[data-drawer-state="avatar-focus"] .expand-btn {
  display: none;
}

/* When expanded, show collapse icon */
.widget-root.expanded .expand-btn .expand-icon {
  display: none;
}

.widget-root.expanded .expand-btn .collapse-icon {
  display: block;
}

/* Expanded state - larger widget */
.widget-root.expanded {
  width: 500px;
  height: 600px !important;
  --widget-height: 600px;
}

/* Expanded text-focus: larger chat area */
.widget-root.expanded[data-drawer-state="text-focus"] {
  --chat-height: 454px; /* Expanded chat height */
}

/* Expanded text-focus: chat section fills available space */
.widget-root.expanded[data-drawer-state="text-focus"] .chat-section {
  height: 214px;
}

.control-btn {
  background: transparent;
  border: none;
  color: var(--text-color);
  width: 32px;
  height: 32px;
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
}

.control-btn:hover {
  background: rgba(0, 0, 0, 0.08);
}

.theme-dark .control-btn {
  color: white;
}

.theme-dark .control-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* ==========================================================================
   View Mode Toggle Button
   ========================================================================== */
/* Default: show text icon (we're in avatar-focus), hide avatar icon */
#viewModeBtn .text-mode-icon {
  display: block;
}

#viewModeBtn .avatar-mode-icon {
  display: none;
}

/* In text-focus mode: show avatar icon, hide text icon */
[data-drawer-state="text-focus"] #viewModeBtn .text-mode-icon {
  display: none;
}

[data-drawer-state="text-focus"] #viewModeBtn .avatar-mode-icon {
  display: block;
}

/* ==========================================================================
   Avatar Section (Variable Height - extends behind header)
   ========================================================================== */
.avatar-section {
  height: var(--avatar-height);
  min-height: 0;
  flex-shrink: 0;
  flex-grow: 0;
  position: relative;
  overflow: visible; /* Allow avatar to overflow into header */
  margin-top: -56px; /* Pull up behind header (header height) */
  padding-top: 56px; /* Compensate so content stays in place */
  transition: height var(--transition-duration) cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* When in text-focus mode, reposition avatar section into the header circle */
[data-drawer-state="text-focus"] .avatar-section {
  position: absolute;
  left: -30px; /* Further left */
  top: -28px; /* Higher position */
  transform: none;
  width: 100px;
  height: 100px;
  border-radius: 50%;
  overflow: visible; /* Allow status dot to overflow */
  z-index: 20;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25), 0 4px 16px rgba(0, 0, 0, 0.15);
  margin-top: 0;
  padding-top: 0;
  transition: none; /* Disable transition for instant repositioning */
}

/* Clip avatar content to circle but allow status dot to overflow */
[data-drawer-state="text-focus"] .avatar-stage {
  border-radius: 50%;
  overflow: hidden;
}

/* Green status dot on avatar circle in text-focus mode */
[data-drawer-state="text-focus"] .avatar-section::after {
  content: '';
  position: absolute;
  bottom: 10px;
  right: 10px;
  width: 8px;
  height: 8px;
  background: #10b981;
  border-radius: 50%;
  box-shadow: 0 0 6px #10b981;
  z-index: 25;
}

/* Hide status dot from header text in text-focus mode */
[data-drawer-state="text-focus"] .header-title .status-dot {
  display: none;
}

[data-drawer-state="text-focus"] .avatar-stage {
  background: white;
}

.theme-dark [data-drawer-state="text-focus"] .avatar-stage {
  background: #1e2130;
}

/* Keep canvas at full resolution for quality, just reposition to show face in circle */
[data-drawer-state="text-focus"] .avatar-render-container {
  width: 800px;
  height: 800px;
  top: 62%; /* Move avatar higher in circle */
  left: 50%;
  transform: translate(-50%, -50%) scale(0.32); /* Bigger avatar */
}

.avatar-stage {
  position: absolute;
  top: 0; /* Fills from the pulled-up position (behind header) */
  left: 0;
  right: 0;
  bottom: 0;
  background: radial-gradient(circle at center 40%, #f0f4ff 0%, #ffffff 80%);
  overflow: hidden;
}

.theme-dark .avatar-stage {
  background: radial-gradient(circle at center 30%, #2d3748 0%, #0f111a 100%);
}

/* Avatar Render Container (Injected by LazyAvatar) */
.avatar-render-container {
  width: 800px;
  height: 800px;
  position: absolute;
  /* Position avatar lower in its box */
  top: 55%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.70);
  transform-origin: center center;
  pointer-events: none;
  z-index: 5; /* Below header but visible */
}

.avatar-render-container canvas {
  width: 100% !important;
  height: 100% !important;
  object-fit: contain;
}

/* Avatar position adjustment for avatar-focus mode - keep head at same distance from header */
[data-drawer-state="avatar-focus"] .avatar-render-container {
  top: 48%;
}

/* ==========================================================================
   Avatar Subtitles - Cinematic Live Captions (visible only in avatar-focus mode)
   ========================================================================== */
.avatar-subtitles {
  display: none;
  position: absolute;
  bottom: 4px; /* Anchored to bottom */
  left: 50%;
  transform: translateX(-50%);
  width: 85%; /* Slightly narrower for padding from edges */
  max-width: 300px;
  text-align: center;
  
  /* Typography - Match header font style */
  font-size: 16px;
  font-weight: 400;
  line-height: 1.45;
  letter-spacing: -0.01em;
  color: #333333;
  
  /* No background - just text */
  background: transparent;
  padding: 8px 16px; /* Added horizontal padding */
  
  /* Layout - fixed height to prevent jumping */
  z-index: 15;
  min-height: 48px; /* Fixed min height for 1 line */
  max-height: 72px; /* Max for 2 lines */
  overflow: hidden;
  
  /* Anchor text to bottom of container */
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  
  /* Smooth appearance */
  opacity: 0;
  transition: opacity 0.25s ease;
}

/* Fade in animation for new text */
@keyframes subtitleFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.avatar-subtitles.visible {
  animation: subtitleFadeIn 0.25s ease forwards;
}

.theme-dark .avatar-subtitles {
  color: #e8e8e8;
}

/* Only show subtitles in avatar-focus mode */
[data-drawer-state="avatar-focus"] .avatar-subtitles {
  display: flex;
}

/* Hide subtitles in text-focus mode */
[data-drawer-state="text-focus"] .avatar-subtitles {
  display: none !important;
}

/* Show when has content */
[data-drawer-state="avatar-focus"] .avatar-subtitles:not(:empty) {
  opacity: 1;
}

/* Hide when empty */
.avatar-subtitles:empty {
  opacity: 0 !important;
  pointer-events: none;
}

/* User subtitle style - just different color, no italics */
.avatar-subtitles.user-speaking {
  color: #4B4ACF;
}

.theme-dark .avatar-subtitles.user-speaking {
  color: #a5a4f3;
}

/* ==========================================================================
   Avatar Suggestions (visible only in avatar-focus mode)
   ========================================================================== */
.avatar-suggestions {
  display: none;
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
  gap: 8px;
  padding: 8px;
  z-index: 15;
}

/* Show only in avatar-focus mode */
[data-drawer-state="avatar-focus"] .avatar-suggestions {
  display: flex;
}

/* Hide when conversation has started */
.widget-root.has-messages .avatar-suggestions {
  display: none !important;
}

.avatar-suggestions .suggestion-chip {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid var(--border-color);
  color: var(--primary-color);
  padding: 6px 12px;
  border-radius: 16px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  backdrop-filter: blur(8px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.avatar-suggestions .suggestion-chip:hover {
  background: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(75, 74, 207, 0.25);
}

.theme-dark .avatar-suggestions .suggestion-chip {
  background: rgba(30, 33, 48, 0.9);
  border-color: #3f445e;
  color: #e0e0e0;
}

.theme-dark .avatar-suggestions .suggestion-chip:hover {
  background: var(--primary-color);
  color: white;
}

/* ==========================================================================
   Section Divider (simple line between avatar and chat)
   ========================================================================== */
.section-divider {
  display: none; /* Removed - using gradient fade instead */
}

/* ==========================================================================
   Chat Section (Variable Height)
   ========================================================================== */
.chat-section {
  height: var(--chat-height);
  min-height: 0;
  flex-shrink: 0;
  flex-grow: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  background: var(--bg-color);
  margin-top: 0; /* No overlap - give avatar space */
  z-index: 5; /* Above avatar */
  transition: height var(--transition-duration) cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* Fade gradient at top of chat for smooth text disappear */
.chat-section::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 30px;
  background: linear-gradient(to bottom, var(--bg-color) 0%, transparent 100%);
  pointer-events: none;
  z-index: 10;
}

/* Remove overlap in text-focus mode */
[data-drawer-state="text-focus"] .chat-section {
  margin-top: 0;
}

/* Chat Messages */
.chat-messages {
  flex: 1;
  padding: 12px 16px 4px 16px;
  overflow-y: auto;  /* Only show scrollbar when needed */
  display: flex;
  flex-direction: column;
  /* Scrollbar styling - minimal and hidden until hover/scroll */
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  opacity: 0; /* Hidden initially - show when has messages */
  pointer-events: none;
  transition: opacity 0.2s ease;
}

/* Show scrollbar on hover */
.chat-messages:hover {
  scrollbar-color: rgba(0,0,0,0.15) transparent;
}

/* Show chat messages when conversation has started */
.widget-root.has-messages .chat-messages {
  opacity: 1;
  pointer-events: auto;
}

.chat-messages::-webkit-scrollbar {
  width: 3px;
}

.chat-messages::-webkit-scrollbar-track {
  background: transparent;
}

.chat-messages::-webkit-scrollbar-thumb {
  background-color: transparent;
  border-radius: 3px;
  transition: background-color 0.2s ease;
}

.chat-messages:hover::-webkit-scrollbar-thumb {
  background-color: rgba(0,0,0,0.15);
}

/* Quick Replies (shown when no messages) */
.quick-replies {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-end;
  gap: 10px;
  padding: 12px 16px;
  transition: opacity 0.2s ease;
}

.quick-replies.hidden {
  opacity: 0;
  pointer-events: none;
}

.suggestion-chip {
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  color: var(--primary-color);
  padding: 6px 12px;
  border-radius: 16px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.suggestion-chip:hover {
  background: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(75, 74, 207, 0.25);
}

.theme-dark .suggestion-chip {
  background: #2a2e42;
  border-color: #3f445e;
  color: #e0e0e0;
}
.theme-dark .suggestion-chip:hover {
  background: var(--primary-color);
  color: white;
}

/* Typing Indicator - absolutely positioned at bottom, floats on top of messages */
.typing-indicator {
  display: none;
  position: absolute;
  bottom: 8px;
  left: 16px;
  padding: 6px 12px;
  background: var(--input-bg);
  border-radius: 12px;
  z-index: 10;
}

.typing-indicator.visible {
  display: flex;
}

.typing-dots {
  display: flex;
  gap: 4px;
  padding: 4px 2px;
}

.typing-dots span {
  width: 6px;
  height: 6px;
  background: #b0b0b0;
  border-radius: 50%;
  animation: typingBounce 1.4s infinite ease-in-out both;
}

.typing-dots span:nth-child(1) { animation-delay: -0.32s; }
.typing-dots span:nth-child(2) { animation-delay: -0.16s; }

@keyframes typingBounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

/* ==========================================================================
   Input Layer (Fixed Height: 90px - ABSOLUTELY positioned at bottom)
   ========================================================================== */
.input-layer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 90px !important;
  min-height: 90px !important;
  max-height: 90px !important;
  background: var(--bg-color);
  z-index: 100; /* Above everything */
}

/* Upward gradient to soften the hard edge where footer meets chat */
.input-layer::before {
  content: '';
  position: absolute;
  top: -20px;
  left: 0;
  right: 0;
  height: 20px;
  background: linear-gradient(to top, var(--bg-color) 0%, transparent 100%);
  pointer-events: none;
}

/* ==========================================================================
   Message Styles
   ========================================================================== */
.message {
  display: flex;
  flex-direction: column;
  animation: slideUp 0.3s ease;
  max-width: 85%;
  margin-bottom: 4px;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.message.user {
  align-self: flex-end;
  align-items: flex-end;
}

.message.assistant {
  align-self: flex-start;
  align-items: stretch;
}

.message-bubble {
  padding: 10px 16px;
  border-radius: 18px;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.5;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}

.message.user .message-bubble {
  background: var(--primary-color);  /* Flat solid color instead of gradient */
  color: white;
  border-bottom-right-radius: 4px;
  /* No drop shadow - looks like content, not a button */
}

.message.assistant .message-bubble {
  background: white;
  color: var(--text-color);
  border-bottom-left-radius: 4px;
  border: 1px solid var(--border-color);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.message-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
  padding: 0 4px;
  min-height: 20px;
}

.message-time {
  font-size: 11px;
  color: #9ca3af;
}

.theme-dark .message.assistant .message-bubble {
  background: #1a1a2e;
  color: #e0e0e0;
}

/* Chat Input Area */
.chat-input-area {
  padding: 16px;
  background: var(--bg-color);
  flex-shrink: 0;
}

.chat-input-wrapper {
  margin-bottom: 8px;
}

.chat-input-controls {
  display: flex;
  gap: 10px;
  align-items: center;
  flex: 1; /* Ensure it takes width */
}

/* Button Swapping Logic -> Co-existence Logic */

/* Mic: Always visible */
.chat-input-controls #micBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent; /* Subtle background */
  width: 40px;
  height: 40px;
  color: #6b7280; /* Gray when inactive */
  margin-left: 4px;
}
.chat-input-controls #micBtn:hover {
  background: #f3f4f6;
  color: var(--primary-color);
  transform: scale(1.05);
}

/* Send: Hidden when empty, Popped In when text exists */
.chat-input-controls:not(.has-text) #sendBtn {
  display: none;
}

.chat-input-controls.has-text #sendBtn {
  display: flex;
  animation: popIn 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

/* Remove old conflicting hidden rules */
.chat-input-controls.has-text #micBtn {
  display: flex; /* Keep visible! */
}


@keyframes popIn {
  from { transform: scale(0); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
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
  color: #9ca3af;
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

.input-button#micBtn {
  color: var(--text-color);
}
.input-button.recording {
  color: #e74c3c !important;
  background: rgba(231, 76, 60, 0.1);
  animation: recordPulse 1.5s infinite;
}

.input-button#sendBtn {
  background: var(--primary-color);
  color: white;
  padding: 10px;
}
.input-button#sendBtn:hover {
  transform: scale(1.05);
}

.branding {
  text-align: center;
  font-size: 10px;
  color: #9ca3af;
  margin-top: 4px;
}

.branding a {
  color: #7986cb;
  text-decoration: none;
}
.branding a:hover {
  text-decoration: underline;
}

/* ==========================================================================
   Launcher Bubble (New Face Design)
   ========================================================================== */
:host(.collapsed) {
  width: auto !important;
  height: auto !important;
  bottom: 20px !important;
  right: 20px !important;
  top: auto !important;
  left: auto !important;
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
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--bg-color);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  position: relative;
  /* Removed overflow: hidden so status dot can sit on the rim */
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  z-index: 20;
}

.chat-bubble:hover {
  transform: scale(1.1);
}

.bubble-avatar-preview {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border-radius: 50%; /* moved radius here */
  overflow: hidden; /* moved clip here for image */
}

.avatar-face-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.bubble-avatar-preview .status-dot {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 14px; /* Slightly larger */
  height: 14px;
  background: #10b981;
  border: 2px solid white;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  z-index: 5;
}

/* Tooltip (Proactive Reach Out) */
.bubble-tooltip-wrapper {
  position: absolute;
  right: 74px; /* Left of the bubble */
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  width: max-content; /* Ensure it takes needed space */
  max-width: 240px; /* Increased to allow 2 lines */
  display: flex;
  justify-content: flex-end;
}

.bubble-tooltip {
  pointer-events: auto;
  background: white;
  color: #333;
  padding: 10px 14px; /* Slightly more compact */
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  font-size: 13px; /* Slightly smaller text */
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 10px;
  opacity: 0;
  transform: translateX(10px);
  animation: tooltipSlideIn 0.5s cubic-bezier(0.19, 1, 0.22, 1) 1.5s forwards;
  position: relative;
}

.bubble-tooltip.hidden {
  display: none;
}

.bubble-tooltip::after {
  content: '';
  position: absolute;
  right: -6px;
  top: 50%;
  width: 12px;
  height: 12px;
  background: white;
  transform: translateY(-50%) rotate(45deg); /* Diamond shape, centered */
  border-radius: 2px;
}

.tooltip-close {
  background: none;
  border: none;
  color: var(--text-muted, #9ca3af);
  cursor: pointer;
  font-size: 18px;
  padding: 0;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
}
.tooltip-close:hover {
  background: var(--input-bg);
  color: var(--text-color);
}

@keyframes tooltipSlideIn {
  to { opacity: 1; transform: translateX(0); }
}

@keyframes recordPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

/* ==========================================================================
   Mobile Full Screen Takeover
   ========================================================================== */
@media (max-width: 480px) {
  :host(:not(.collapsed)) {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    width: 100% !important;
    height: 100% !important;
    max-width: none !important;
    max-height: none !important;
    border-radius: 0 !important;
    z-index: 9999999 !important;
  }
  
  :host(:not(.collapsed)) .widget-root {
    width: 100% !important;
    height: 100% !important;
    border-radius: 0 !important;
    border: none !important;
  }
  
  /* Adjust container sizes for mobile */
  :host(:not(.collapsed)) .avatar-stage {
    height: 40%; /* Decreased from 50% to favor chat bubbles */
  }
  
  :host(:not(.collapsed)) .avatar-render-container {
    transform: translateX(-50%) scale(0.65); /* Adjusted for mobile */
    bottom: -150px; /* Adjusted coordinate */
  }

  /* Make header bigger on mobile */
  :host(:not(.collapsed)) .chat-header-overlay {
    padding: 16px;
  }
}

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
