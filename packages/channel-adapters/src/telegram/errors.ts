export class TelegramApiError extends Error {
  public readonly statusCode?: number;
  public readonly errorCode?: number;
  public readonly retryAfter?: number;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      errorCode?: number;
      retryAfter?: number;
    }
  ) {
    super(message);
    this.name = 'TelegramApiError';
    this.statusCode = options?.statusCode;
    this.errorCode = options?.errorCode;
    this.retryAfter = options?.retryAfter;
  }
}
