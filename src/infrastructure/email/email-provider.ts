export type EmailMessage = Readonly<{ to: string; subject: string; text: string }>;

export type EmailProviderError = Readonly<{
  code: 'provider_temporary' | 'provider_rejected' | 'provider_configuration';
  retryable: boolean;
}>;

export interface EmailProvider {
  send(
    message: EmailMessage,
    idempotencyKey: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ providerMessageId: string }>;
}
