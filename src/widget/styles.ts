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
/* 
 * System font stack for CSP compliance
 * Avoids @import which violates Content-Security-Policy on strict sites
 * Falls back gracefully across all platforms
 */

/* Reset all inherited styles */
:host {
  all: initial;
  display: block;
  /* System font stack - CSP compliant, no external font loading */
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
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
  /* Heights - avatar-focus default: avatar 280px (includes 56px behind header) */
  --widget-height: 370px;
  --avatar-height: 280px;  /* avatar-focus default: reduced for less bottom whitespace */
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
    height: 100vh; /* Fallback for older browsers */
    height: 100dvh; /* Dynamic viewport height - accounts for mobile browser UI */
    max-height: 100vh;
    max-height: 100dvh;
    border-radius: 0;
    /* Let the mobile media query at the bottom handle the rest */
    padding-bottom: 90px; /* Ensure input layer space is preserved */
  }
}

.widget-root.minimized {
  transform: translateY(20px) scale(0.9);
  opacity: 0;
  pointer-events: none;
  transition: transform 0.3s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.3s ease;
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
  padding: 8px 16px 16px 16px; /* Less top padding to move content up */
  display: flex;
  justify-content: space-between;
  align-items: center;
  /* Default: transparent when avatar is visible */
  background: transparent;
  background-color: transparent;
  z-index: 10;
  position: relative;
  transition: background 0.3s ease;
}

/* Avatar-focus header - ALWAYS transparent */
[data-drawer-state="avatar-focus"] .header-layer {
  background: transparent !important;
  background-color: transparent !important;
}

/* Solid header when text-focus (avatar collapsed) - Alcove design */
[data-drawer-state="text-focus"] .header-layer {
  background: var(--bg-color);
  height: 70px !important;
  min-height: 70px !important;
  max-height: 70px !important;
  padding-left: 90px; /* Text indentation: 72px avatar + 18px gap */
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
  flex: 1; /* Take available space */
}

/* Center header text in text-focus mode */
[data-drawer-state="text-focus"] .header-info {
  text-align: center;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Center title in text-focus */
[data-drawer-state="text-focus"] .header-title {
  justify-content: center;
}

.header-title .status-dot {
  display: none; /* Hidden - removed green light */
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

.header-buttons {
  display: flex;
  align-items: center;
  gap: 4px; /* Tight spacing */
  margin-left: auto; /* Push to right */
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

/* Expanded text-focus: chat section fills available space - uses CSS var */
.widget-root.expanded[data-drawer-state="text-focus"] .chat-section {
  height: var(--chat-height);
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
  stroke-width: 2.5; /* Bolder icons */
}

.control-btn:hover {
  background: rgba(0, 0, 0, 0.08);
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

/* When in text-focus mode, reposition avatar as "Mascot" orb */
[data-drawer-state="text-focus"] .avatar-section {
  position: absolute;
  left: -25px; /* Hangs off the left edge */
  top: -10px; /* Equator aligns with card top - anchored feel */
  transform: none;
  width: 90px; /* Bigger Mascot size */
  height: 90px;
  border-radius: 50%;
  overflow: visible;
  z-index: 100; /* Float above everything */
  background: white; /* White background for the orb */
  
  /* The Casing - thick white border */
  border: 4px solid #FFFFFF;
  
  /* Softer shadow - mainly downwards (porthole, not sticker) */
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    
  margin-top: 0;
  padding-top: 0;
  transition: none;
}

/* Clip avatar content to circle but allow status dot to overflow */
[data-drawer-state="text-focus"] .avatar-stage {
  border-radius: 50%;
  overflow: hidden;
}

/* Green status dot on avatar circle in text-focus mode - HIDDEN */
[data-drawer-state="text-focus"] .avatar-section::after {
  display: none;
}

/* Hide status dot from header text in text-focus mode */
[data-drawer-state="text-focus"] .header-title .status-dot {
  display: none;
}

[data-drawer-state="text-focus"] .avatar-stage {
  background: white;
}

/* Keep canvas at full resolution for quality, just reposition to show face in circle */
[data-drawer-state="text-focus"] .avatar-render-container {
  width: 800px;
  height: 800px;
  top: 58%; /* Adjust for 80px circle */
  left: 50%;
  transform: translate(-50%, -50%) scale(0.24); /* Zoomed out 5% for porthole effect - show shoulders */
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

/* Avatar position adjustment for avatar-focus mode - balanced for reduced widget height */
[data-drawer-state="avatar-focus"] .avatar-render-container {
  top: 52%;
}

/* ==========================================================================
   Avatar Mist Overlay - Permanent gradient to hide messy splat edges
   Creates seamless fade from avatar into white background
   ========================================================================== */
.avatar-mist-overlay {
  position: absolute;
  bottom: -40px; /* Lowered significantly to match avatar position */
  left: 0;
  width: 100%;
  height: 140px; /* Increased height to cover more area */
  
  /* The Magic Gradient: Transparent top -> Solid White bottom */
  background: linear-gradient(to bottom, 
    rgba(255, 255, 255, 0) 0%, 
    rgba(255, 255, 255, 0.7) 45%,
    rgba(255, 255, 255, 0.9) 70%,
    #FFFFFF 100%
  );
  
  z-index: 10; /* ON TOP of avatar, BEHIND text/input */
  pointer-events: none; /* Let clicks pass through */
}

/* Only show mist in avatar-focus mode */
[data-drawer-state="avatar-focus"] .avatar-mist-overlay {
  display: block;
}

/* Hide mist in text-focus mode */
[data-drawer-state="text-focus"] .avatar-mist-overlay {
  display: none;
}

/* ==========================================================================
   Avatar Subtitles - Floating Text in the Mist (visible only in avatar-focus mode)
   Clean, minimal text floating in the white mist zone
   ========================================================================== */
.avatar-subtitles {
  display: none;
  position: absolute;
  bottom: 0px; /* Balanced position in the mist zone */
  left: 0;
  right: 0;
  margin: 0 auto;
  text-align: center;
  
  /* Typography - Compact and readable */
  font-family: 'Inter', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  font-weight: 500; /* Medium - not bold, less aggressive */
  line-height: 1.4;
  letter-spacing: -0.01em;
  color: #374151; /* Soft Dark Grey - easier on the eyes */
  
  /* NO background box - floating text */
  background: transparent;
  border: none;
  box-shadow: none;
  border-radius: 0;
  padding: 0 16px;
  
  /* Tiny shadow to lift it off the mist */
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);
  
  /* Layout - constrained width for compact display */
  z-index: 25; /* Above the mist layer (mist is z-index 10) */
  max-width: 320px; /* Constrain width for shorter subtitles */
  width: fit-content;
  
  /* Single line with ellipsis fallback */
  white-space: nowrap;
  overflow: hidden;
  
  /* Smooth appearance */
  opacity: 0;
  transition: opacity 0.3s ease;
}

/* Fade in animation */
@keyframes subtitleFadeIn {
  from { 
    opacity: 0; 
    transform: translateY(4px);
  }
  to { 
    opacity: 1; 
    transform: translateY(0);
  }
}

.avatar-subtitles.visible {
  animation: subtitleFadeIn 0.3s ease forwards;
}

/* Only show subtitles in avatar-focus mode */
[data-drawer-state="avatar-focus"] .avatar-subtitles {
  display: block;
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

/* User subtitle style - accent color, no box */
.avatar-subtitles.user-speaking {
  color: #4B4ACF;
}

/* Karaoke-style highlight for current word being spoken */
.avatar-subtitles .subtitle-current {
  color: #4B4ACF;
  font-weight: 600;
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
  gap: 4px;
  padding: 4px;
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
  padding: 6px 10px;
  border-radius: 16px;
  font-size: 11px;
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

/* Add top padding in text-focus so messages don't start under avatar */
[data-drawer-state="text-focus"] .chat-messages {
  padding-top: 20px;
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
  align-items: center; /* Center horizontally */
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

/* Curved bottom corners for text-focus mode (since widget-root has overflow: visible) */
[data-drawer-state="text-focus"] .input-layer {
  border-bottom-left-radius: 20px;
  border-bottom-right-radius: 20px;
}

/* Upward gradient to soften the hard edge where footer meets chat - only in text-focus mode */
[data-drawer-state="text-focus"] .input-layer::before {
  content: '';
  position: absolute;
  top: -20px;
  left: 0;
  right: 0;
  height: 20px;
  background: linear-gradient(to top, var(--bg-color) 0%, transparent 100%);
  pointer-events: none;
}

/* No gradient in avatar-focus mode - subtitles need to be crisp */
[data-drawer-state="avatar-focus"] .input-layer::before {
  display: none;
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
  line-height: 1.6; /* Breathing room for readability */
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}

.message.user .message-bubble {
  background: var(--primary-color);  /* Solid brand color */
  color: white;
  border-bottom-right-radius: 4px;
}

.message.assistant .message-bubble {
  background: #FFFFFF; /* White card */
  color: #374151; /* Dark text */
  border-bottom-left-radius: 4px;
  border: 1px solid #F3F4F6; /* Very subtle border for definition */
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06); /* Soft shadow - creates elevation */
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

/* Chat Input Area */
.chat-input-area {
  padding: 16px;
  background: var(--bg-color);
  flex-shrink: 0;
}

/* Curved bottom corners for text-focus mode (since widget-root has overflow: visible) */
[data-drawer-state="text-focus"] .chat-input-area {
  border-bottom-left-radius: 20px;
  border-bottom-right-radius: 20px;
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

.avatar-fallback-icon {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #4B4ACF 0%, #2E3A87 100%);
  color: white;
}

.bubble-avatar-preview .status-dot {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 14px;
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
    max-height: 100% !important;
    border-radius: 0 !important;
    border: none !important;
    /* Override CSS custom properties for mobile full-screen */
    --widget-height: 100% !important;
  }
  
  /* Avatar-focus mode on mobile: avatar takes most of the space */
  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] {
    --avatar-height: calc(100vh - 56px - 90px) !important; /* Fallback */
    --avatar-height: calc(100dvh - 56px - 90px) !important; /* Full height minus header and input */
    background: transparent !important; /* Let avatar stage show through */
  }
  
  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] .avatar-section {
    height: 100% !important; /* Full height */
    margin-top: 0 !important;
    padding-top: 0 !important;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 90px; /* Above input */
  }
  
  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] .avatar-stage {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    height: auto !important;
  }
  
  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] .avatar-render-container {
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0.85); /* Larger on mobile */
  }
  
  /* Header in avatar-focus mode on mobile - solid color, not transparent */
  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] .header-layer,
  [data-drawer-state="avatar-focus"] .header-layer,
  .widget-root[data-drawer-state="avatar-focus"] .header-layer {
    background: #ffffff !important;
    background-color: #ffffff !important;
  }
  
  /* Use solid white background for avatar stage on mobile - matches input/chat */
  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] .avatar-stage {
    background: #ffffff !important; /* Pure white for light theme */
  }
  
  /* Text-focus mode on mobile: chat takes most of the space, avatar in corner */
  :host(:not(.collapsed)) [data-drawer-state="text-focus"] {
    --chat-height: calc(100vh - 70px - 90px) !important; /* Fallback */
    --chat-height: calc(100dvh - 70px - 90px) !important; /* Full height minus header and input */
  }
  
  :host(:not(.collapsed)) [data-drawer-state="text-focus"] .chat-section {
    height: calc(100vh - 70px - 90px) !important; /* Fallback */
    height: calc(100dvh - 70px - 90px) !important;
    flex: 1;
  }
  
  /* Avatar orb in text-focus stays same size but repositioned for mobile */
  :host(:not(.collapsed)) [data-drawer-state="text-focus"] .avatar-section {
    left: -15px; /* Less overhang on mobile */
    top: -5px;
    width: 70px; /* Slightly smaller on mobile */
    height: 70px;
    border-width: 3px;
  }
  
  :host(:not(.collapsed)) [data-drawer-state="text-focus"] .avatar-render-container {
    transform: translate(-50%, -50%) scale(0.20); /* Scaled for smaller orb */
  }

  /* Make header bigger on mobile */
  :host(:not(.collapsed)) .chat-header-overlay {
    padding: 16px;
  }
  
  /* Adjust header text indent for smaller avatar orb in text-focus */
  :host(:not(.collapsed)) [data-drawer-state="text-focus"] .header-layer {
    padding-left: 70px; /* Reduced from 90px for smaller mobile avatar */
  }
  
  /* Reposition avatar orb in text-focus mode on mobile - no overflow */
  :host(:not(.collapsed)) [data-drawer-state="text-focus"] .avatar-section {
    left: 10px; /* Inside the widget, not hanging off */
    top: 8px; /* Moved down to stay within bounds */
  }
  
  /* Disable expanded state on mobile - already full screen */
  :host(:not(.collapsed)) .widget-root.expanded {
    width: 100% !important;
    height: 100% !important;
  }
  
  /* Hide expand button on mobile */
  :host(:not(.collapsed)) .expand-btn {
    display: none !important;
  }
  
  /* Larger suggestion chips on mobile - balanced between avatar and input */
  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] .avatar-suggestions {
    bottom: 110px; /* Similar position to subtitles, above input */
    width: 95%;
    max-width: none;
    gap: 6px;
    padding: 4px;
  }
  
  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] .avatar-suggestions .suggestion-chip {
    padding: 8px 12px;
    font-size: 13px;
    border-radius: 16px;
  }
  
  /* Mist overlay on mobile - covers lower portion without reaching avatar's face */
  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] .avatar-mist-overlay {
    display: block;
    bottom: 0;
    height: 35vh; /* Cover lower third of screen */
  }
  
  /* Subtitles on mobile - positioned between avatar and input */
  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] .avatar-subtitles {
    display: block;
    bottom: 100px; /* Above input (90px) + some padding */
    max-width: 90%;
    width: auto;
    font-size: 15px;
    white-space: normal; /* Allow wrapping on mobile */
    line-height: 1.5;
    padding: 0 20px;
  }
  
  :host(:not(.collapsed)) [data-drawer-state="avatar-focus"] .avatar-subtitles:not(:empty) {
    opacity: 1;
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
