/**
 * Widget Styles
 * Immersive 3D Avatar Layout (2026 Redesign)
 */

export const WIDGET_STYLES = `
/* Reset all inherited styles */
:host {
  all: initial;
  display: block;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #333;
  box-sizing: border-box;
  --primary-color: #4B4ACF;
  --primary-gradient: linear-gradient(135deg, #4B4ACF 0%, #2E3A87 100%);
  --bg-color: #ffffff;
  --text-color: #333;
  --input-bg: #f5f5f7;
  --border-color: #e0e0e0;
  --avatar-stage-height: 50%;
}

:host * {
  box-sizing: inherit;
}

/* Position variants */
:host(.position-bottom-right) { position: fixed; bottom: 20px; right: 20px; z-index: 999999; }
:host(.position-bottom-left) { position: fixed; bottom: 20px; left: 20px; z-index: 999999; }
:host(.position-top-right) { position: fixed; top: 20px; right: 20px; z-index: 999999; }
:host(.position-top-left) { position: fixed; top: 20px; left: 20px; z-index: 999999; }
:host(.position-inline) { position: relative; height: 540px; width: 350px; }
:host(.hidden) { display: none !important; }

/* Main container */
.widget-root {
  width: 350px;
  height: auto; /* Auto height based on content */
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
  border-radius: 20px;
  /* Softer shadow */
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12), 0 4px 8px rgba(0, 0, 0, 0.05);
  overflow: hidden;
  transition: transform 0.3s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.3s ease;
  position: absolute;
  bottom: 0; /* Anchor to bottom so expansion goes upward */
  right: 0;
  border: 1px solid rgba(0,0,0,0.08);
}

@media (max-width: 480px) {
  .widget-root {
    width: 100vw;
    height: 100vh;
    max-height: 100vh;
    border-radius: 0;
    bottom: 0;
    right: 0;
  }
}

.widget-root.minimized {
  transform: translateY(20px) scale(0.9);
  opacity: 0;
  pointer-events: none;
}

.widget-root.theme-dark {
  --bg-color: #0f111a;
  --text-color: #ffffff;
  --input-bg: #1e2130;
  --border-color: #2a2e42;
  color: white;
}

/* ==========================================================================
   Avatar Stage (Top Half)
   ========================================================================== */
.avatar-stage {
  height: 240px; /* Fixed height for avatar section */
  position: relative;
  background: radial-gradient(circle at center 40%, #f0f4ff 0%, #ffffff 80%);
  overflow: hidden;
  flex-shrink: 0;
}

.theme-dark .avatar-stage {
  background: radial-gradient(circle at center 30%, #2d3748 0%, #0f111a 100%);
}

/* Avatar Render Container (Injected by LazyAvatar) */
.avatar-render-container {
  width: 800px;
  height: 800px;
  position: absolute;
  /* Adjusted to center avatar in its section */
  bottom: -160px;
  left: 50%;
  transform: translateX(-50%) scale(0.70);
  transform-origin: center bottom;
  pointer-events: none; /* Allow interaction with header overlay */
}

.avatar-render-container canvas {
  width: 100% !important;
  height: 100% !important;
  object-fit: contain;
}

/* Header Overlay */
.chat-header-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 12px 16px; /* Reduced padding to push content to top */
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  z-index: 10;
  /* Removed heavy linear gradient for cleaner look */
  background: transparent; 
}

.header-info {
  /* Removed the "Square" background that covered hair */
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  padding: 0;
  border: none;
  box-shadow: none;
  display: flex;
  flex-direction: column;
}

.header-info h3 {
  margin: 0;
  font-size: 16px; /* Slightly larger for readability without bg */
  font-weight: 700;
  color: #1a1a1a;
  /* Added white glow for readability over avatar hair/bg */
  text-shadow: 0 0 10px rgba(255,255,255,0.8), 0 0 2px rgba(255,255,255,1);
  letter-spacing: -0.01em;
}

.theme-dark .header-info {
  background: transparent;
  border-color: transparent;
}

.theme-dark .header-info h3 {
  color: white;
  text-shadow: 0 1px 4px rgba(0,0,0,0.8);
}

.status-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-color);
  padding: 2px 0;
  margin-top: 2px;
  /* Add subtle shadow for readability */
  text-shadow: 0 0 8px rgba(255,255,255,0.8);
}

/* Green Dot */
.status-badge::before {
  content: '';
  display: block;
  width: 6px;
  height: 6px;
  background-color: #10b981;
  border-radius: 50%;
  box-shadow: 0 0 4px #10b981;
}

.theme-dark .status-badge {
  color: #ccc;
}

.control-btn {
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.4);
  color: #1a1a1a;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
}

.control-btn:hover {
  background: rgba(255, 255, 255, 0.8);
  transform: scale(1.05);
}

.theme-dark .control-btn {
  color: white;
  background: rgba(0, 0, 0, 0.4);
  border-color: rgba(255,255,255,0.1);
}

/* ==========================================================================
   Chat Interface (Bottom Half)
   ========================================================================== */
.chat-interface {
  flex-shrink: 0; /* Don't shrink */
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.95); /* Slightly translucent */
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  position: relative;
  z-index: 5;
  /* Removed Sheet Overlap (-24px margin & radius) */
  margin-top: 0;
  border-top: 1px solid rgba(0,0,0,0.05); /* Clean straight separation */
  overflow: hidden; /* Added to constrain child elements */
}

/* Container for messages and quick-replies - they stack in same space */
.chat-content-area {
  position: relative;
  height: 130px; /* Compact height for suggestions */
  flex-shrink: 0;
  transition: height 0.2s ease;
}

/* Expanded state - more room for conversation */
.widget-root.expanded .chat-content-area {
  height: 220px; /* ~25% more space for messages */
}

/* Fade overlay at the top of chat interface */
.chat-interface::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 24px;
  background: linear-gradient(to bottom, rgba(255,255,255,1) 0%, rgba(255,255,255,0) 100%);
  z-index: 10; /* Above messages */
  pointer-events: none;
}

.theme-dark .chat-interface::before {
  background: linear-gradient(to bottom, var(--bg-color) 0%, transparent 100%);
}

.chat-messages {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 20px;
  overflow-y: auto;
  display: block;
  /* Scrollbar styling */
  scrollbar-width: thin;
  scrollbar-color: rgba(0,0,0,0.1) transparent;
  opacity: 0; /* Hidden initially */
  pointer-events: none;
  transition: opacity 0.2s ease;
}

/* Messages container for flex layout */
.chat-messages .message {
  margin-bottom: 12px;
}

/* Show chat messages when conversation starts */
.widget-root.expanded .chat-messages {
  opacity: 1;
  pointer-events: auto;
}

.chat-messages::-webkit-scrollbar {
  width: 4px;
}
.chat-messages::-webkit-scrollbar-thumb {
  background-color: rgba(0,0,0,0.1);
  border-radius: 4px;
}

.message {
  display: flex;
  flex-direction: column;
  animation: slideUp 0.3s ease;
  max-width: 85%; /* Restore max-width constraint */
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
  align-items: stretch; /* Ensure footer spans full width of the bubble */
}

.message-bubble {
  padding: 10px 16px;
  border-radius: 18px;
  font-size: 14px;
  line-height: 1.5;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}

.message.user .message-bubble {
  background: var(--primary-gradient); /* Modern Gradient Bubble */
  color: white;
  border-bottom-right-radius: 4px;
  box-shadow: 0 4px 12px rgba(75, 74, 207, 0.25); /* Colored shadow for depth */
}

.message.assistant .message-bubble {
  background: white;
  color: var(--text-color);
  border-bottom-left-radius: 4px;
  border: 1px solid var(--border-color);
}

.message-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
  padding: 0 4px; /* Align with bubble curvature */
  min-height: 20px;
}

.message-time {
  font-size: 11px;
  color: #9ca3af;
}

/* Response Feedback (Thumbs Up/Down) */
.message-feedback {
  display: flex;
  gap: 8px;
  opacity: 0;
  transform: translateY(-5px);
  transition: opacity 0.3s, transform 0.3s;
  pointer-events: none; /* Disabled when hidden */
}

/* Show feedback only when message is hovered or active */
.message.assistant:hover .message-feedback,
.message.assistant .message-feedback.active {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.feedback-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: #9ca3af;
  transition: all 0.2s;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.feedback-btn:hover {
  background: #f3f4f6;
  color: #4b5563;
}

.feedback-btn.selected {
  color: var(--primary-color);
  background: #e0e7ff;
}

.feedback-btn:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

.feedback-btn svg {
  width: 14px;
  height: 14px;
}

.theme-dark .message-feedback .feedback-btn {
  color: #6b7280;
}

.theme-dark .message-feedback .feedback-btn:hover {
  background: #2a2e42;
  color: #9ca3af;
}

.theme-dark .message-feedback .feedback-btn.selected {
  color: var(--primary-color);
  background: rgba(75, 74, 207, 0.2);
}

.theme-dark .message.assistant .message-bubble {
  background: #1a1a2e;
  color: #e0e0e0;
}

/* Quick Replies */
.quick-replies {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  justify-content: center; /* Center vertically */
  align-items: flex-end; /* Align to right like user bubbles */
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
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
  font-weight: 500;
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

/* Typing Indicator - positioned at bottom of chat area */
.typing-indicator {
  display: none; /* Hidden by default */
  position: absolute;
  bottom: 8px;
  left: 20px;
  background: var(--assistant-bubble);
  border-radius: 16px;
  padding: 8px 12px;
  z-index: 5;
}

.typing-indicator.visible {
  display: flex; /* Only show when visible class is added */
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

/* Chat Input Area */
.chat-input-area {
  padding: 16px;
  background: var(--bg-color);
  border-top: 1px solid var(--border-color);
  flex-shrink: 0; /* Prevent input from being compressed */
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

.status-dot {
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
