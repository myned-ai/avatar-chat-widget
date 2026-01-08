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
  private isIntentionallyClosed = false;
  private useBinaryProtocol = false; // Disable binary protocol - backend expects JSON
  private authService: AuthService;

  constructor(private url: string = CONFIG.websocket.url) {
    super();

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
          } as any;
        }
      } else {
        // JSON message (fallback for non-binary messages)
        message = JSON.parse(event.data);
      }

      this.emit('message', message);
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
    if (!this.isIntentionallyClosed && this.reconnectAttempts < CONFIG.websocket.reconnectAttempts) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout !== null) {
      return;
    }

    this.setConnectionState('reconnecting');
    const delay = this.calculateReconnectDelay();
    
    log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${CONFIG.websocket.reconnectAttempts})`);

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
        this.send({ type: 'ping', timestamp: Date.now() } as any);
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
          this.ws!.send(JSON.stringify(jsonMessage));
        } else {
          // Send JSON data
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
