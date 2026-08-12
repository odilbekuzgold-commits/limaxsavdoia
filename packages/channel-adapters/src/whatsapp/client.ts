export interface WhatsAppClientOptions {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
}

export interface SendWhatsAppTextMessageOptions {
  toPhoneNumber: string;
  text: string;
  previewUrl?: boolean;
}

export class WhatsAppClient {
  private accessToken: string;
  private phoneNumberId: string;
  private apiVersion: string;

  constructor(options: WhatsAppClientOptions) {
    this.accessToken = options.accessToken;
    this.phoneNumberId = options.phoneNumberId;
    this.apiVersion = options.apiVersion || 'v21.0';
  }

  async sendTextMessage(options: SendWhatsAppTextMessageOptions): Promise<{ messaging_product: string; contacts: unknown[]; messages: Array<{ id: string }> }> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: options.toPhoneNumber,
      type: 'text',
      text: {
        preview_url: options.previewUrl ?? false,
        body: options.text,
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        // Redact token in logs/errors
        const safeError = errText.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***REDACTED***');
        throw new Error(`WhatsApp API error (${response.status}): ${safeError.substring(0, 100)}`);
      }

      return (await response.json()) as { messaging_product: string; contacts: unknown[]; messages: Array<{ id: string }> };
    } catch (err: unknown) {
      if (err instanceof Error) {
        const redactedMsg = err.message.replace(/access_token=[^&]+/gi, 'access_token=***REDACTED***');
        throw new Error(redactedMsg);
      }
      throw err;
    }
  }

  verifyWebhookToken(token: string, expectedToken: string): boolean {
    return Boolean(token && expectedToken && token === expectedToken);
  }
}
