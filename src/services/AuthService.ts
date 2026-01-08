// Authentication Service for HMAC Token Management

import { CONFIG } from '../config';
import { errorBoundary } from '../utils/ErrorBoundary';
import { logger } from '../utils/Logger';

const log = logger.scope('AuthService');

export interface AuthToken {
  token: string;
  ttl: number;
  origin: string;
  expiresAt: number;
}

export class AuthService {
  private currentToken: AuthToken | null = null;
  private tokenEndpoint: string;

  constructor() {
    // Derive token endpoint from WebSocket URL
    const wsUrl = CONFIG.websocket.url;
    const httpUrl = wsUrl.replace('ws://', 'http://').replace('wss://', 'https://');
    const baseUrl = httpUrl.substring(0, httpUrl.lastIndexOf('/ws'));
    this.tokenEndpoint = `${baseUrl}/api/auth/token`;
  }

  /**
   * Request a new authentication token from the server
   */
  async requestToken(): Promise<string> {
    try {
      const response = await fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get auth token: ${response.status} ${errorText}`);
      }

      const data = await response.json();

      // Store token with expiration time
      this.currentToken = {
        token: data.token,
        ttl: data.ttl,
        origin: data.origin,
        expiresAt: Date.now() + (data.ttl * 1000), // Convert seconds to ms
      };

      log.debug(`Auth token received (valid for ${data.ttl}s)`);
      return data.token;

    } catch (error) {
      errorBoundary.handleError(error as Error, 'auth');
      throw error;
    }
  }

  /**
   * Get the current token, requesting a new one if needed
   */
  async getToken(): Promise<string> {
    // Check if we have a valid token
    if (this.currentToken && this.isTokenValid()) {
      return this.currentToken.token;
    }

    // Request new token
    return await this.requestToken();
  }

  /**
   * Check if the current token is still valid
   * Returns false if token is expired or will expire in the next 60 seconds
   */
  private isTokenValid(): boolean {
    if (!this.currentToken) {
      return false;
    }

    // Add 60 second buffer to prevent using token that's about to expire
    const bufferMs = 60 * 1000;
    return Date.now() + bufferMs < this.currentToken.expiresAt;
  }

  /**
   * Clear the current token (useful for logout or error scenarios)
   */
  clearToken(): void {
    this.currentToken = null;
  }

  /**
   * Get the time remaining before token expiration (in seconds)
   */
  getTokenTimeRemaining(): number | null {
    if (!this.currentToken) {
      return null;
    }

    const remainingMs = this.currentToken.expiresAt - Date.now();
    return Math.max(0, Math.floor(remainingMs / 1000));
  }
}
