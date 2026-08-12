import { z } from 'zod';

export const WhatsAppMessageSchema = z.object({
  from: z.string().min(1),
  id: z.string().min(1),
  timestamp: z.string(),
  type: z.enum(['text', 'image', 'document', 'audio', 'video', 'location', 'interactive', 'template', 'unknown']).default('text'),
  text: z.object({ body: z.string() }).optional(),
  image: z.object({ id: z.string(), caption: z.string().optional() }).optional(),
  document: z.object({ id: z.string(), filename: z.string().optional(), caption: z.string().optional() }).optional(),
  location: z.object({ latitude: z.number(), longitude: z.number(), name: z.string().optional() }).optional(),
});

export type WhatsAppMessage = z.infer<typeof WhatsAppMessageSchema>;

export const WhatsAppValueSchema = z.object({
  messaging_product: z.string().default('whatsapp'),
  metadata: z.object({
    display_phone_number: z.string(),
    phone_number_id: z.string(),
  }),
  contacts: z.array(
    z.object({
      profile: z.object({ name: z.string() }),
      wa_id: z.string(),
    })
  ).optional(),
  messages: z.array(WhatsAppMessageSchema).optional(),
  statuses: z.array(z.record(z.unknown())).optional(),
});

export type WhatsAppValue = z.infer<typeof WhatsAppValueSchema>;

export const WhatsAppChangeSchema = z.object({
  value: WhatsAppValueSchema,
  field: z.string(),
});

export const WhatsAppEntrySchema = z.object({
  id: z.string(),
  changes: z.array(WhatsAppChangeSchema),
});

export const WhatsAppWebhookSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(WhatsAppEntrySchema),
});

export type WhatsAppWebhookPayload = z.infer<typeof WhatsAppWebhookSchema>;
