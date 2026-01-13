/**
 * Widget Styles
 * Based on the clean design from index.html
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
}

:host *, :host *::before, :host *::after {
  box-sizing: inherit;
}

/* Position variants */
:host(.position-bottom-right) { position: fixed; bottom: 20px; right: 20px; z-index: 999999; }
:host(.position-bottom-left) { position: fixed; bottom: 20px; left: 20px; z-index: 999999; }
:host(.position-top-right) { position: fixed; top: 20px; right: 20px; z-index: 999999; }
:host(.position-top-left) { position: fixed; top: 20px; left: 20px; z-index: 999999; }
:host(.position-inline) { position: relative; }
:host(.hidden) { display: none !important; }

/* Main container */
.widget-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  overflow: visible;
  transition: transform 0.3s ease;
  position: relative;
}

.widget-root.minimized {
  transform: scale(0);
  opacity: 0;
  pointer-events: none;
}

.widget-root.theme-dark {
  background: #1a1a2e;
  color: #e0e0e0;
}

/* Collapsed bubble state */
:host(.collapsed) {
  width: 60px !important;
  height: 60px !important;
}

.chat-bubble {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.chat-bubble:hover {
  transform: scale(1.1);
  box-shadow: 0 6px 25px rgba(102, 126, 234, 0.5);
}

.chat-bubble.hidden {
  transform: scale(0);
  opacity: 0;
  pointer-events: none;
}

.chat-bubble svg {
  width: 28px;
  height: 28px;
  color: white;
}

/* Avatar Circle - Breaking out at top */
.avatar-circle {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: #ffffff;
  border: 3px solid #667eea;
  overflow: hidden;
  position: absolute;
  left: -35px;
  top: -40px;
  z-index: 1001;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.widget-root.minimized .avatar-circle {
  opacity: 0;
  pointer-events: none;
  transform: scale(0.5);
}

.theme-dark .avatar-circle {
  background: #1a1a2e;
  border-color: #764ba2;
}

/* Avatar render container - high-res rendering scaled down */
.avatar-render-container {
  width: 800px;
  height: 800px;
  position: absolute;
  top: -80px;
  left: 50%;
  transform: translateX(-50%) scale(0.38);
  transform-origin: center top;
  will-change: transform;
}

.avatar-render-container canvas {
  width: 800px !important;
  height: 800px !important;
  object-fit: contain;
}

.avatar-circle > canvas {
  width: 800px !important;
  height: 800px !important;
  position: absolute;
  top: -80px;
  left: 50%;
  transform: translateX(-50%) scale(0.38);
  transform-origin: center top;
  object-fit: contain;
}

/* Speaking indicator */
.avatar-circle.speaking {
  border-color: #27ae60;
  box-shadow: 0 6px 30px rgba(0, 0, 0, 0.3), 0 0 0 5px rgba(39, 174, 96, 0.3);
  animation: speakPulse 1s infinite;
}

@keyframes speakPulse {
  0%, 100% { box-shadow: 0 6px 30px rgba(0, 0, 0, 0.3), 0 0 0 5px rgba(39, 174, 96, 0.3); }
  50% { box-shadow: 0 6px 30px rgba(0, 0, 0, 0.3), 0 0 0 10px rgba(39, 174, 96, 0.1); }
}

/* Chat Header */
.chat-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 14px;
  padding-left: 95px;
  border-radius: 12px 12px 0 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  position: relative;
}

.theme-dark .chat-header {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
}

.chat-header h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}

.chat-header-buttons {
  display: flex;
  gap: 8px;
}

.chat-header-buttons button {
  background: rgba(255, 255, 255, 0.2);
  border: none;
  color: white;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.chat-header-buttons button:hover {
  background: rgba(255, 255, 255, 0.3);
}

/* Messages Container */
.messages-section {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  min-height: 250px;
  max-height: 320px;
  background: #fafafa;
}

.theme-dark .messages-section {
  background: #16213e;
}

.message {
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.message.user {
  align-items: flex-end;
}

.message.assistant {
  align-items: flex-start;
}

.message-bubble {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 16px;
  word-wrap: break-word;
  font-size: 14px;
  line-height: 1.45;
}

.message.user .message-bubble {
  background: #667eea;
  color: white;
  border-bottom-right-radius: 4px;
}

.message.assistant .message-bubble {
  background: white;
  color: #333;
  border: 1px solid #e0e0e0;
  border-bottom-left-radius: 4px;
}

.theme-dark .message.assistant .message-bubble {
  background: #1a1a2e;
  color: #e0e0e0;
  border-color: #333;
}

.message-time {
  font-size: 11px;
  color: #999;
  margin-top: 6px;
  padding: 0 4px;
}

/* Input Area */
.input-section {
  padding: 12px;
  background: white;
  border-top: 1px solid #e0e0e0;
  border-radius: 0 0 12px 12px;
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.theme-dark .input-section {
  background: #1a1a2e;
  border-top-color: #333;
}

.chat-input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #e0e0e0;
  border-radius: 20px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
  font-family: inherit;
}

.chat-input:focus {
  border-color: #667eea;
}

.theme-dark .chat-input {
  background: #16213e;
  border-color: #333;
  color: #e0e0e0;
}

.action-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: none;
  background: #667eea;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}

.action-btn:hover:not(:disabled) {
  background: #5568d3;
  transform: scale(1.05);
}

.action-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.action-btn.recording {
  background: #e74c3c;
  animation: recordPulse 1.5s infinite;
}

@keyframes recordPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
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
