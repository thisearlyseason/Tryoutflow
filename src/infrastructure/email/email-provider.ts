import { z } from 'zod';

export type EmailMessage = Readonly<{ to: string; subject: string; text: string }>;

export const providerMessageIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);

export type EmailProviderError = Readonly<{
  code:
    'provider_temporary' | 'provider_rejected' | 'provider_configuration' | 'delivery_uncertain';
  retryable: boolean;
}>;

export interface EmailProvider {
  send(
    message: EmailMessage,
    idempotencyKey: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ providerMessageId: string }>;
}
