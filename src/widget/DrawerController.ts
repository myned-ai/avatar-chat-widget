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
import { 
  LAYOUT, 
  AVATAR_LAYOUT, 
  CHAT_LAYOUT, 
  WIDGET_HEIGHTS 
} from '../constants/layout';

const log = logger.scope('DrawerController');

export type DrawerState = 'text-focus' | 'avatar-focus';

interface DrawerControllerOptions {
  widgetRoot: HTMLElement;
  avatarSection: HTMLElement;
  chatSection: HTMLElement;
  onStateChange?: (state: DrawerState) => void;
}

// State configuration using shared layout constants
const STATE_CONFIG: Record<DrawerState, { avatar: number; chat: number; widgetHeight: number }> = {
  'text-focus': { 
    avatar: AVATAR_LAYOUT.TEXT_FOCUS_HEIGHT,
    chat: CHAT_LAYOUT.TEXT_FOCUS_HEIGHT,
    widgetHeight: WIDGET_HEIGHTS.TEXT_FOCUS
  },
  'avatar-focus': { 
    avatar: AVATAR_LAYOUT.FOCUS_FULL_HEIGHT,
    chat: CHAT_LAYOUT.AVATAR_FOCUS_HEIGHT,
    widgetHeight: WIDGET_HEIGHTS.AVATAR_FOCUS
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
    
    log.debug('DrawerController initialized', { 
      headerHeight: LAYOUT.HEADER_HEIGHT,
      inputHeight: LAYOUT.INPUT_HEIGHT 
    });
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
