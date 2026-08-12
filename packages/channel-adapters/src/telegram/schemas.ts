import { z } from 'zod';

export const TelegramUserSchema = z.object({
  id: z.number(),
  is_bot: z.boolean(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
  can_connect_to_business: z.boolean().optional(),
});

export const TelegramChatSchema = z.object({
  id: z.number(),
  type: z.enum(['private', 'group', 'supergroup', 'channel']),
  title: z.string().optional(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});

export const TelegramMessageSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    message_id: z.number(),
    from: TelegramUserSchema.optional(),
    sender_chat: TelegramChatSchema.optional(),
    date: z.number(),
    chat: TelegramChatSchema,
    text: z.string().optional(),
    caption: z.string().optional(),
    business_connection_id: z.string().optional(),
    sender_business_bot: TelegramUserSchema.optional(),
    reply_to_message: TelegramMessageSchema.optional(),
    photo: z.array(z.record(z.unknown())).optional(),
    document: z.record(z.unknown()).optional(),
    audio: z.record(z.unknown()).optional(),
    voice: z.record(z.unknown()).optional(),
    video: z.record(z.unknown()).optional(),
  })
);

export const TelegramBusinessConnectionSchema = z.object({
  id: z.string(),
  user: TelegramUserSchema,
  user_chat_id: z.number(),
  date: z.number(),
  can_reply: z.boolean(),
  is_enabled: z.boolean(),
});

export const TelegramBusinessMessagesDeletedSchema = z.object({
  business_connection_id: z.string(),
  chat: TelegramChatSchema,
  message_ids: z.array(z.number()),
});

export const TelegramUpdateSchema = z.object({
  update_id: z.number(),
  message: TelegramMessageSchema.optional(),
  edited_message: TelegramMessageSchema.optional(),
  business_connection: TelegramBusinessConnectionSchema.optional(),
  business_message: TelegramMessageSchema.optional(),
  edited_business_message: TelegramMessageSchema.optional(),
  deleted_business_messages: TelegramBusinessMessagesDeletedSchema.optional(),
});
