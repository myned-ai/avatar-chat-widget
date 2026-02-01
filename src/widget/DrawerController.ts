/**
 * DrawerController - View Mode Controller for Avatar/Chat layout
 * 
 * Manages two view modes (no drag, just button selection):
 * - text-focus: Chat with small avatar in header, full height
 * - avatar-focus: Avatar only, no chat, smaller height
 * 
 * Header and input are always visible in all states.
 */

import { logger } from '../utils/Logger';

const log = logger.scope('DrawerController');

export type DrawerState = 'text-focus' | 'avatar-focus';

interface DrawerControllerOptions {
  widgetRoot: HTMLElement;
  avatarSection: HTMLElement;
  chatSection: HTMLElement;
  onStateChange?: (state: DrawerState) => void;
}

// Fixed heights in pixels
const HEADER_HEIGHT = 56;
const INPUT_HEIGHT = 90;
const FULL_WIDGET_HEIGHT = 540;

// Content area for avatar + chat at full height
// Widget has padding-bottom: 90px for input, so content area = height - header - input
const CONTENT_AREA = FULL_WIDGET_HEIGHT - HEADER_HEIGHT - INPUT_HEIGHT; // = 394px

// Avatar needs extra 56px to account for padding-top (fills behind header)
const AVATAR_PADDING = 56;  // matches header height

// Text-focus chat height - full height
const CHAT_HEIGHT_TEXT_FOCUS = 394; // 540 - 56 header - 90 input = 394px for chat

// Avatar-focus content height (smaller size - reduced for less bottom whitespace)
const AVATAR_FOCUS_CONTENT = 224;

// State configuration - avatar height includes padding to extend behind header
const STATE_CONFIG: Record<DrawerState, { avatar: number; chat: number; widgetHeight: number }> = {
  'text-focus': { 
    avatar: 0,
    chat: CHAT_HEIGHT_TEXT_FOCUS,  // 394px for chat
    // Full widget height: 540px
    widgetHeight: FULL_WIDGET_HEIGHT
  },
  'avatar-focus': { 
    // Smaller height: header + 224 + input = 370px
    // Avatar fills the content area: 224px + 56px padding = 280px
    avatar: AVATAR_FOCUS_CONTENT + AVATAR_PADDING,  // 224 + 56 = 280px (extends behind header)
    chat: 0,
    // Widget: 370px
    widgetHeight: HEADER_HEIGHT + AVATAR_FOCUS_CONTENT + INPUT_HEIGHT
  },
};

export class DrawerController {
  private widgetRoot: HTMLElement;
  private avatarSection: HTMLElement;
  private chatSection: HTMLElement;
  private onStateChange?: (state: DrawerState) => void;

  private currentState: DrawerState = 'avatar-focus';

  constructor(options: DrawerControllerOptions) {
    this.widgetRoot = options.widgetRoot;
    this.avatarSection = options.avatarSection;
    this.chatSection = options.chatSection;
    this.onStateChange = options.onStateChange;

    this.applyState(this.currentState);
    
    log.debug('DrawerController initialized', { contentArea: CONTENT_AREA });
  }

  getState(): DrawerState {
    return this.currentState;
  }

  setState(state: DrawerState): void {
    if (state !== this.currentState) {
      this.currentState = state;
      this.applyState(state);
      this.onStateChange?.(state);
    }
  }

  /**
   * Cycle through states: avatar-focus -> text-focus -> avatar-focus
   */
  toggle(): void {
    const states: DrawerState[] = ['avatar-focus', 'text-focus'];
    const currentIndex = states.indexOf(this.currentState);
    const nextIndex = (currentIndex + 1) % states.length;
    this.setState(states[nextIndex]);
  }

  private applyState(state: DrawerState): void {
    const config = STATE_CONFIG[state];
    
    // Apply CSS custom properties
    this.widgetRoot.style.setProperty('--widget-height', `${config.widgetHeight}px`);
    this.widgetRoot.style.setProperty('--avatar-height', `${config.avatar}px`);
    this.widgetRoot.style.setProperty('--chat-height', `${config.chat}px`);
    
    // Data attribute for CSS styling (header transparency, divider visibility)
    this.widgetRoot.setAttribute('data-drawer-state', state);

    // Show/hide sections based on state
    if (state === 'avatar-focus') {
      this.avatarSection.style.display = 'block';
      this.chatSection.style.display = 'none';
    } else if (state === 'text-focus') {
      // Avatar section stays visible but CSS repositions it into the header circle
      this.avatarSection.style.display = 'block';
      this.chatSection.style.display = 'flex';
    }

    log.debug(`State: ${state}`, { widgetHeight: config.widgetHeight, avatar: config.avatar, chat: config.chat });
  }

  /**
   * Cleanup (no listeners to remove now)
   */
  destroy(): void {
    log.debug('DrawerController destroyed');
  }
}
