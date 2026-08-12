import type { NormalizedChannelMessage, SupportedChannel } from './types.js';

export type ChannelMessageHandler = (message: NormalizedChannelMessage) => Promise<unknown>;

export class ChannelRouter {
  private handlers: Map<SupportedChannel, ChannelMessageHandler> = new Map();

  registerHandler(channel: SupportedChannel, handler: ChannelMessageHandler): void {
    this.handlers.set(channel, handler);
  }

  async dispatch(message: NormalizedChannelMessage): Promise<unknown> {
    const handler = this.handlers.get(message.channel);
    if (!handler) {
      throw new Error(`No registered handler for channel '${message.channel}'`);
    }
    return handler(message);
  }

  hasHandler(channel: SupportedChannel): boolean {
    return this.handlers.has(channel);
  }
}
