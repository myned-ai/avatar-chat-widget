/**
 * Binary WebSocket Protocol
 * Eliminates 33% base64 overhead by using native binary frames
 *
 * Message Format:
 * [1 byte: message type code]
 * [4 bytes: timestamp (uint32)]
 * [n bytes: payload]
 *
 * Payload formats vary by message type - see MESSAGE_CODECS
 */

import type { IncomingMessage, OutgoingMessage } from '../types/messages';

// Message type codes (1 byte)
export enum MessageTypeCode {
  // Outgoing (client -> server)
  PING = 0x01,
  AUDIO_INPUT = 0x02,
  CHAT_MESSAGE = 0x03,
  TEXT = 0x04,

  // Incoming (server -> client)
  PONG = 0x81,
  AUDIO_CHUNK = 0x82,
  BLENDSHAPE = 0x83,
  SYNC_FRAME = 0x84,
  TEXT_CHUNK = 0x85,
  STATE_UPDATE = 0x86,
  ERROR = 0x87,
}

// Reverse mapping for decoding
const CODE_TO_TYPE: Record<number, string> = {
  [MessageTypeCode.PING]: 'ping',
  [MessageTypeCode.AUDIO_INPUT]: 'audio_input',
  [MessageTypeCode.CHAT_MESSAGE]: 'chat_message',
  [MessageTypeCode.TEXT]: 'text',
  [MessageTypeCode.PONG]: 'pong',
  [MessageTypeCode.AUDIO_CHUNK]: 'audio_chunk',
  [MessageTypeCode.BLENDSHAPE]: 'blendshape',
  [MessageTypeCode.SYNC_FRAME]: 'sync_frame',
  [MessageTypeCode.TEXT_CHUNK]: 'text_chunk',
  [MessageTypeCode.STATE_UPDATE]: 'state_update',
  [MessageTypeCode.ERROR]: 'error',
};

const TYPE_TO_CODE: Record<string, MessageTypeCode> = {
  'ping': MessageTypeCode.PING,
  'audio_input': MessageTypeCode.AUDIO_INPUT,
  'chat_message': MessageTypeCode.CHAT_MESSAGE,
  'text': MessageTypeCode.TEXT,
  'pong': MessageTypeCode.PONG,
  'audio_chunk': MessageTypeCode.AUDIO_CHUNK,
  'blendshape': MessageTypeCode.BLENDSHAPE,
  'sync_frame': MessageTypeCode.SYNC_FRAME,
  'text_chunk': MessageTypeCode.TEXT_CHUNK,
  'state_update': MessageTypeCode.STATE_UPDATE,
  'error': MessageTypeCode.ERROR,
};

/**
 * Binary Protocol Encoder/Decoder
 */
export class BinaryProtocol {
  /**
   * Encode a message to binary format
   * Returns ArrayBuffer ready to send over WebSocket
   */
  static encode(message: OutgoingMessage): ArrayBuffer {
    const typeCode = TYPE_TO_CODE[message.type];

    if (typeCode === undefined) {
      throw new Error(`Unknown message type: ${message.type}`);
    }

    // Special handling for audio messages (most common, performance-critical)
    if (message.type === 'audio_input' && message.data instanceof ArrayBuffer) {
      return this.encodeAudioInput(typeCode, message.data);
    }

    // For other messages, fallback to JSON payload (still saves base64 overhead)
    return this.encodeGeneric(typeCode, message);
  }

  /**
   * Decode a binary message from server
   * Returns parsed message object
   */
  static decode(buffer: ArrayBuffer): IncomingMessage {
    const view = new DataView(buffer);

    // Read header
    const typeCode = view.getUint8(0);
    const timestamp = view.getUint32(1, false); // Big-endian

    const messageType = CODE_TO_TYPE[typeCode];
    if (!messageType) {
      throw new Error(`Unknown message type code: ${typeCode}`);
    }

    // Decode payload based on type
    switch (typeCode) {
      case MessageTypeCode.AUDIO_CHUNK:
        return this.decodeAudioChunk(messageType, timestamp, buffer);

      case MessageTypeCode.BLENDSHAPE:
        return this.decodeBlendshape(messageType, timestamp, buffer);

      case MessageTypeCode.SYNC_FRAME:
        return this.decodeSyncFrame(messageType, timestamp, buffer);

      default:
        // Generic JSON payload
        return this.decodeGeneric(messageType, timestamp, buffer);
    }
  }

  /**
   * Encode audio input message
   * Format: [type:1][timestamp:4][audio_data:n]
   */
  private static encodeAudioInput(typeCode: MessageTypeCode, audioData: ArrayBuffer): ArrayBuffer {
    const headerSize = 5; // 1 byte type + 4 bytes timestamp
    const totalSize = headerSize + audioData.byteLength;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    // Write header
    view.setUint8(0, typeCode);
    view.setUint32(1, Date.now(), false); // Big-endian timestamp

    // Copy audio data
    const dest = new Uint8Array(buffer, headerSize);
    const src = new Uint8Array(audioData);
    dest.set(src);

    return buffer;
  }

  /**
   * Encode generic message with JSON payload
   * Format: [type:1][timestamp:4][json_length:4][json_data:n]
   */
  private static encodeGeneric(typeCode: MessageTypeCode, message: any): ArrayBuffer {
    const jsonStr = JSON.stringify(message);
    const jsonBytes = new TextEncoder().encode(jsonStr);

    const headerSize = 9; // 1 + 4 + 4
    const totalSize = headerSize + jsonBytes.length;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    // Write header
    view.setUint8(0, typeCode);
    view.setUint32(1, Date.now(), false);
    view.setUint32(5, jsonBytes.length, false);

    // Copy JSON data
    const dest = new Uint8Array(buffer, headerSize);
    dest.set(jsonBytes);

    return buffer;
  }

  /**
   * Decode audio chunk message
   * Format: [type:1][timestamp:4][audio_data:n]
   */
  private static decodeAudioChunk(type: string, timestamp: number, buffer: ArrayBuffer): IncomingMessage {
    const headerSize = 5;
    const audioData = buffer.slice(headerSize);

    return {
      type: type as any,
      audio: audioData,
      timestamp,
    } as any;
  }

  /**
   * Decode blendshape message
   * Format: [type:1][timestamp:4][weights:52*4 bytes as float32]
   */
  private static decodeBlendshape(type: string, timestamp: number, buffer: ArrayBuffer): IncomingMessage {
    const headerSize = 5;
    const weightsData = new Float32Array(buffer, headerSize, 52);

    // Copy to new array (since buffer may be reused)
    const weights = new Float32Array(52);
    weights.set(weightsData);

    return {
      type: type as any,
      weights: Array.from(weights),
      timestamp,
    } as any;
  }

  /**
   * Decode sync_frame message
   * Format: [type:1][timestamp:4][audio_length:4][audio_data:n][weights:52*4 bytes]
   */
  private static decodeSyncFrame(type: string, timestamp: number, buffer: ArrayBuffer): IncomingMessage {
    const view = new DataView(buffer);
    const headerSize = 5;

    // Read audio length
    const audioLength = view.getUint32(headerSize, false);
    const audioStart = headerSize + 4;
    const weightsStart = audioStart + audioLength;

    // Extract audio data
    const audioData = buffer.slice(audioStart, weightsStart);

    // Extract blendshape weights
    const weightsData = new Float32Array(buffer, weightsStart, 52);
    const weights = new Float32Array(52);
    weights.set(weightsData);

    return {
      type: type as any,
      audio: audioData,
      weights: Array.from(weights),
      timestamp,
    } as any;
  }

  /**
   * Decode generic message with JSON payload
   * Format: [type:1][timestamp:4][json_length:4][json_data:n]
   */
  private static decodeGeneric(type: string, timestamp: number, buffer: ArrayBuffer): IncomingMessage {
    const view = new DataView(buffer);
    const headerSize = 9;

    const jsonLength = view.getUint32(5, false);
    const jsonBytes = new Uint8Array(buffer, headerSize, jsonLength);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    const payload = JSON.parse(jsonStr);

    return {
      ...payload,
      type,
      timestamp,
    };
  }

  /**
   * Check if binary protocol is supported by checking message type
   */
  static isBinaryMessage(data: any): boolean {
    return data instanceof ArrayBuffer;
  }

  /**
   * Estimate bandwidth savings
   */
  static estimateSavings(originalSize: number): { binarySize: number; savings: number; savingsPercent: number } {
    // Base64 encoding adds ~33% overhead
    const base64Size = Math.ceil(originalSize * 1.33);
    const binarySize = originalSize + 5; // Just header overhead
    const savings = base64Size - binarySize;
    const savingsPercent = (savings / base64Size) * 100;

    return { binarySize, savings, savingsPercent };
  }
}
