/**
 * Default avatar asset resolution.
 *
 * The package ships a default avatar (public/asset/nyx.zip). When the library
 * is loaded from a CDN (jsDelivr/unpkg), the asset URL is derived from the
 * script tag; otherwise a local path is assumed.
 */

/**
 * Get the URL for the bundled default avatar. Auto-detects CDN usage by
 * scanning script tags and returns the appropriate URL.
 */
export function getDefaultAvatarUrl(): string {
  const scripts = document.getElementsByTagName('script');
  for (let i = 0; i < scripts.length; i++) {
    const src = scripts[i].src;
    if (src.includes('jsdelivr.net') && src.includes('avatar-chat-widget')) {
      const baseUrl = src.substring(0, src.lastIndexOf('/'));
      return `${baseUrl}/avatar-chat-widget/public/asset/nyx.zip`;
    }
    if (src.includes('unpkg.com') && src.includes('avatar-chat-widget')) {
      const baseUrl = src.substring(0, src.lastIndexOf('/'));
      return `${baseUrl}/avatar-chat-widget/public/asset/nyx.zip`;
    }
  }
  // Fallback for npm usage or local development
  return '/asset/nyx.zip';
}
