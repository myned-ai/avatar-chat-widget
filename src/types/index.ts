// Types barrel export
export type { 
  BaseMessage,
  OutgoingTextMessage,
  OutgoingAudioMessage,
  OutgoingMessage,
  IncomingTextMessage,
  AudioStartMessage,
  AudioChunkMessage,
  AudioEndMessage,
  BlendshapeFrameMessage,
  ErrorMessage,
  StatusMessage,
  IncomingMessage,
  BlendshapeFrame,
  AudioBuffer,
  ChatMessage,
} from './messages';

export type {
  Disposable,
  ChatState,
  EventCallback,
  EventEmitter,
  ConnectionState,
  FeatureFlags,
} from './common';

export type {
  IAvatarController,
  IAvatarControllerExtended,
} from './avatar';
