/**
 * Renderer-only mount (no ChatManager, no networking).
 *
 * Mounts the 3D avatar standalone and returns its controller, for host apps
 * that drive state, blendshape weights and audio RMS from their own pipeline.
 */

import { LazyAvatar } from './LazyAvatar';
import type { IAvatarController } from '../types/avatar';
import { getDefaultAvatarUrl } from './default-asset';

/** Options for {@link mountAvatar}. */
export interface MountAvatarOptions {
  /** DOM element or CSS selector to render the avatar into */
  container: string | HTMLElement;
  /** URL of the avatar asset (.zip). Defaults to the bundled Nyx avatar. */
  avatarUrl?: string;
  /** Optional background image drawn behind the avatar inside the 3D scene */
  backgroundImage?: string;
  /** Initial scene background color, hex like "#22d3ee" (default white).
   *  Change it later with {@link MountedAvatar.setBackgroundColor}. */
  backgroundColor?: string;
  /**
   * Internal render resolution in px (default 800). The renderer sizes its
   * canvas from its container, so mountAvatar renders into a renderSize×
   * renderSize layer and CSS-scales it to fit `container` — same trick the
   * full widget uses. Rendering at display size looks soft; leave the default
   * unless you need to trade quality for GPU time.
   */
  renderSize?: number;
  /** Called once the heavy renderer has loaded and is rendering */
  onReady?: () => void;
  /** Called if the renderer fails to load (a fallback UI is shown) */
  onError?: (error: Error) => void;
}

/** Controller returned by {@link mountAvatar}: the full avatar control
 *  surface plus load-state introspection. */
export interface MountedAvatar extends IAvatarController {
  /** True once the heavy renderer has loaded */
  readonly isLoaded: boolean;
  /** True while the heavy renderer is loading */
  readonly isLoading: boolean;
  /** Change the 3D scene background color at runtime (e.g. to follow
   *  conversation state). Hex like "#22d3ee"; queued until the renderer loads. */
  setBackgroundColor(color: string): void;
}

/**
 * Mount the 3D avatar renderer standalone and drive it yourself.
 *
 * Unlike `AvatarChat.init`, this starts NO voice loop, NO WebSocket and
 * NO chat UI — it returns the avatar controller so the host app feeds it
 * state, blendshape weights and audio RMS from its own pipeline:
 *
 * ```ts
 * const avatar = mountAvatar({ container: '#stage' });
 * avatar.setChatState('Listening');
 * avatar.enableLiveBlendshapes();
 * avatar.updateBlendshapes({ jawOpen: 0.4, ... }); // 52 ARKit weights, 30 FPS
 * avatar.updateAudioRMS?.(0.12);                   // gaze behaviour
 * avatar.dispose();                                // unmount
 * ```
 *
 * Multiple mounts are allowed (no singleton). Loading is lazy: a lightweight
 * placeholder shows immediately and the renderer chunk loads in the background.
 */
export function mountAvatar(options: MountAvatarOptions): MountedAvatar {
  if (!options || !options.container) {
    throw new Error('AvatarChat.mountAvatar(): container is required');
  }

  const containerEl = typeof options.container === 'string'
    ? document.querySelector(options.container)
    : options.container;

  if (!containerEl) {
    throw new Error(`AvatarChat.mountAvatar(): container not found: ${options.container}`);
  }

  if (options.avatarUrl !== undefined) {
    if (typeof options.avatarUrl !== 'string') {
      throw new Error('AvatarChat.mountAvatar(): avatarUrl must be a string');
    }
    if (!options.avatarUrl.endsWith('.zip')) {
      throw new Error('AvatarChat.mountAvatar(): avatarUrl must be a .zip file');
    }
    if (options.avatarUrl.includes('..')) {
      throw new Error('AvatarChat.mountAvatar(): avatarUrl cannot contain path traversal');
    }
  }

  if (options.backgroundImage !== undefined && options.backgroundImage.includes('..')) {
    throw new Error('AvatarChat.mountAvatar(): backgroundImage cannot contain path traversal');
  }

  const avatarUrl = options.avatarUrl || getDefaultAvatarUrl();
  const renderSize = options.renderSize ?? 800;

  // The renderer sizes its canvas from its container element, so mounting
  // directly into a small container renders at low resolution. Render into a
  // fixed high-res layer and CSS-scale it to fit the host container instead —
  // the same approach as the full widget's .avatar-render-container.
  const host = containerEl as HTMLElement;
  if (getComputedStyle(host).position === 'static') {
    host.style.position = 'relative';
  }
  if (!host.style.overflow) {
    host.style.overflow = 'hidden';
  }

  const renderLayer = document.createElement('div');
  renderLayer.style.cssText = [
    `width: ${renderSize}px`,
    `height: ${renderSize}px`,
    'position: absolute',
    'top: 50%',
    'left: 50%',
    'transform-origin: center center',
    'pointer-events: none',
  ].join('; ');

  const applyScale = () => {
    const scale = Math.min(host.clientWidth, host.clientHeight) / renderSize || 1;
    renderLayer.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };
  applyScale();
  host.appendChild(renderLayer);

  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(applyScale) : null;
  resizeObserver?.observe(host);

  const avatar = new LazyAvatar(renderLayer as HTMLDivElement, avatarUrl, {
    preload: true,
    backgroundImage: options.backgroundImage,
    backgroundColor: options.backgroundColor,
    onReady: options.onReady,
    onError: options.onError,
  });
  avatar.start();

  // Tear down the render layer and observer together with the avatar.
  const disposeAvatar = avatar.dispose.bind(avatar);
  avatar.dispose = () => {
    disposeAvatar();
    resizeObserver?.disconnect();
    renderLayer.remove();
  };

  return avatar;
}
