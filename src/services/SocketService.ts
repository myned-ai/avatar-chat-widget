// WebSocket Service with Reconnection Logic

import { EventEmitter } from '../utils/EventEmitter';
import { errorBoundary } from '../utils/ErrorBoundary';
import { logger } from '../utils/Logger';
import { CONFIG } from '../config';

const log = logger.scope('SocketService');
import { BinaryProtocol } from '../utils/BinaryProtocol';
import { AuthService } from './AuthService';
import type { IncomingMessage, OutgoingMessage } from '../types/messages';
import type { Disposable, ConnectionState } from '../types/common';

export class SocketService extends EventEmitter implements Disposable {
  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimeout: number | null = null;
  private heartbeatInterval: number | null = null;
  private messageQueue: OutgoingMessage[] = [];
  private readonly maxQueueSize = 100;
  private readonly maxReconnectAttempts = 10;
  private isIntentionallyClosed = false;
  private useBinaryProtocol = false; // Disable binary protocol - backend expects JSON
  private authService: AuthService;
  private url: string;

  constructor(url?: string) {
    super();

    // Read URL at construction time, but allow override
    // This ensures we get the latest CONFIG value after setConfig() is called
    this.url = url ?? CONFIG.websocket.url;

    this.authService = new AuthService();

    errorBoundary.registerHandler('websocket', (error) => {
      this.emit('error', error);
    });
  }

  async connect(): Promise<void> {
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
      return;
    }

    this.isIntentionallyClosed = false;
    this.setConnectionState('connecting');

    // Get authentication token if auth is enabled
    let wsUrl = this.url;
    if (CONFIG.auth.enabled) {
      try {
        const token = await this.authService.getToken();
        // Append token to WebSocket URL as query parameter
        const separator = wsUrl.includes('?') ? '&' : '?';
        wsUrl = `${wsUrl}${separator}token=${encodeURIComponent(token)}`;
        log.debug('Connecting with authentication token');
      } catch (error) {
        log.warn('Failed to get auth token, attempting connection without auth:', error);
        // Continue without auth - server may have auth disabled
      }
    }

    return new Promise((resolve, reject) => {
      let timeout: number | undefined;

      try {
        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = 'arraybuffer';

        // Connection timeout
        timeout = window.setTimeout(() => {
          if (this.connectionState === 'connecting') {
            this.ws?.close();
            reject(new Error('Connection timeout'));
          }
        }, CONFIG.websocket.connectionTimeout);

        this.ws.onopen = () => {
          if (timeout !== undefined) {
            clearTimeout(timeout);
          }
          this.onOpen();
          resolve();
        };

        this.ws.onmessage = (event) => this.onMessage(event);
        this.ws.onerror = (event) => this.onError(event);
        this.ws.onclose = (event) => this.onClose(event);

      } catch (error) {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        this.setConnectionState('error');
        errorBoundary.handleError(error as Error, 'websocket');
        reject(error);
      }
    });
  }

  private onOpen(): void {
    log.info('WebSocket connected');
    this.setConnectionState('connected');
    this.reconnectAttempts = 0;
    this.startHeartbeat();
    this.flushMessageQueue();
    this.emit('connected');
  }

  private onMessage(event: MessageEvent): void {
    try {
      // RAW message logging (before parsing)
      try {
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data);
          const preview = Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
          log.debug('WS raw message (ArrayBuffer)', { byteLength: event.data.byteLength, preview });
        } else if (typeof event.data === 'string') {
          const preview = event.data.length > 300 ? `${event.data.slice(0, 300)}…` : event.data;
          log.debug('WS raw message (string)', { length: event.data.length, preview });
        } else if (event.data instanceof Blob) {
          log.debug('WS raw message (Blob)', { size: event.data.size, type: event.data.type });
        } else {
          log.debug('WS raw message (unknown)', { type: typeof event.data });
        }
      } catch (e) {
        log.warn('Failed to log raw WS message', e);
      }

      let message: IncomingMessage;

      if (event.data instanceof ArrayBuffer) {
        // Binary protocol message
        if (this.useBinaryProtocol) {
          message = BinaryProtocol.decode(event.data);
        } else {
          // Fallback: treat as raw audio data
          message = {
            type: 'audio_chunk',
            data: event.data,
            timestamp: Date.now(),
            sessionId: '',
          };
        }
      } else {
        // JSON message (fallback for non-binary messages)
        message = JSON.parse(event.data);
      }

      this.emit('message', message);
      // DEBUG: Log important message types to console (skip high-frequency ones)
      if (message.type !== 'sync_frame' && message.type !== 'transcript_delta' && message.type !== 'blendshape') {
        console.log('[WS] Received message type:', message.type, message);
      }
      // Lightweight diagnostics: log incoming message metadata useful for frame-skip analysis
      try {
        const meta: Record<string, any> = { type: message.type };
        if ((message as any).frameIndex !== undefined) meta.frameIndex = (message as any).frameIndex;
        if ((message as any).timestamp !== undefined) meta.timestamp = (message as any).timestamp;
        if ((message as any).itemId !== undefined) meta.itemId = (message as any).itemId;
        if (event.data instanceof ArrayBuffer) meta.byteLength = event.data.byteLength;
        log.debug('Incoming message', meta);
      } catch (e) {
        log.warn('Failed to log incoming message meta', e);
      }

      this.emit(message.type, message);

    } catch (error) {
      errorBoundary.handleError(error as Error, 'websocket');
    }
  }

  private onError(event: Event): void {
    log.error('WebSocket error:', event);
    errorBoundary.handleError(new Error('WebSocket error'), 'websocket');
  }

  private onClose(event: CloseEvent): void {
    log.info('WebSocket closed:', event.code, event.reason);
    this.stopHeartbeat();
    this.setConnectionState('disconnected');
    this.emit('disconnected', event);

    // If closed due to auth failure (code 1008), clear token
    if (event.code === 1008 && CONFIG.auth.enabled) {
      log.info('Auth failed, clearing token');
      this.authService.clearToken();
    }

    // Reconnect unless intentionally closed
    if (!this.isIntentionallyClosed) {
      // Check against configured max attempts or fallback to instance max
      const maxAttempts = Math.min(CONFIG.websocket.reconnectAttempts, this.maxReconnectAttempts);

      if (this.reconnectAttempts < maxAttempts) {
        this.scheduleReconnect();
      } else {
        // Max attempts reached - give up
        log.error(`Max reconnection attempts (${maxAttempts}) reached. Giving up.`);
        this.setConnectionState('error');
        this.emit('connection-failed', {
          reason: 'max-retries',
          attempts: this.reconnectAttempts
        });

        // Notify via error boundary
        errorBoundary.handleError(
          new Error(`Failed to connect after ${maxAttempts} attempts`),
          'websocket'
        );
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout !== null) {
      return;
    }

    this.setConnectionState('reconnecting');
    const delay = this.calculateReconnectDelay();
    const maxAttempts = Math.min(CONFIG.websocket.reconnectAttempts, this.maxReconnectAttempts);

    log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${maxAttempts})`);

    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      this.reconnectAttempts++;
      this.connect().catch((error) => {
        log.error('Reconnection failed:', error);
      });
    }, delay);
  }

  private calculateReconnectDelay(): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
    const delay = Math.min(
      CONFIG.websocket.initialReconnectDelay * Math.pow(2, this.reconnectAttempts),
      CONFIG.websocket.maxReconnectDelay
    );
    return delay;
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = window.setInterval(() => {
      if (this.isConnected()) {
        this.send({ type: 'ping', timestamp: Date.now() });
      }
    }, CONFIG.websocket.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  send(message: OutgoingMessage): void {
    if (!this.isConnected()) {
      this.queueMessage(message);
      return;
    }

    try {
      if (this.useBinaryProtocol) {
        // Use binary protocol (33% bandwidth savings vs base64)
        const binaryData = BinaryProtocol.encode(message);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- isConnected() check ensures ws exists
        this.ws!.send(binaryData);
      } else {
        // Fallback: JSON with base64 encoding for audio
        if ((message.type === 'audio_input' || message.type === 'audio') && message.data instanceof ArrayBuffer) {
          // Convert audio ArrayBuffer to base64 for JSON transmission
          const bytes = new Uint8Array(message.data);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64Data = btoa(binary);

          // Send as JSON with base64-encoded audio
          const jsonMessage = {
            ...message,
            data: base64Data,
          };
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- isConnected() check ensures ws exists
          this.ws!.send(JSON.stringify(jsonMessage));
        } else {
          // Send JSON data
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- isConnected() check ensures ws exists
          this.ws!.send(JSON.stringify(message));
        }
      }
    } catch (error) {
      errorBoundary.handleError(error as Error, 'websocket');
      this.queueMessage(message);
    }
  }

  private queueMessage(message: OutgoingMessage): void {
    if (this.messageQueue.length >= this.maxQueueSize) {
      log.warn('Message queue full, dropping oldest message');
      this.messageQueue.shift();
    }
    this.messageQueue.push(message);
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.isConnected()) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Length checked above
      const message = this.messageQueue.shift()!;
      this.send(message);
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.emit('connectionStateChanged', state);
    }
  }

  /**
   * Manually reconnect to the server
   * Resets reconnection counter and attempts immediate connection
   */
  async reconnect(): Promise<void> {
    log.info('Manual reconnect requested');
    this.disconnect();
    this.reconnectAttempts = 0; // Reset counter for fresh attempt
    this.isIntentionallyClosed = false;
    return this.connect();
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;

    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.setConnectionState('disconnected');
  }

  dispose(): void {
    this.disconnect();
    this.removeAllListeners();
    this.messageQueue = [];
  }
}
