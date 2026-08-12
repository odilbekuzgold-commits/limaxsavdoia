export type SupportedChannel = 'telegram' | 'whatsapp' | 'web';

export interface NormalizedChannelMessage {
  channel: SupportedChannel;
  messageId: string;
  senderId: string;
  senderName?: string;
  senderUsername?: string;
  chatId: string;
  text: string;
  messageType: 'text' | 'photo' | 'audio' | 'document' | 'location' | 'other';
  sentAt: Date;
  rawMetadata?: Record<string, unknown>;
}
