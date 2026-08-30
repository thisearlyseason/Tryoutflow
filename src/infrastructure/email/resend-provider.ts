import 'server-only';

import { Resend } from 'resend';
import { z } from 'zod';

import type { EmailMessage, EmailProvider, EmailProviderError } from './email-provider';

const configurationSchema = z.object({
  apiKey: z.string().min(20).max(300),
  from: z.email().max(320),
});

type ResendClient = Pick<Resend, 'emails'>;

export class ResendEmailProvider implements EmailProvider {
  private readonly client: ResendClient;
  private readonly from: string;

  constructor(configuration: unknown, client?: ResendClient) {
    const parsed = configurationSchema.safeParse(configuration);
    if (!parsed.success) {
      throw { code: 'provider_configuration', retryable: false } satisfies EmailProviderError;
    }
    this.from = parsed.data.from;
    this.client = client ?? new Resend(parsed.data.apiKey);
  }

  async send(message: EmailMessage, idempotencyKey: string) {
    try {
      const response = await this.client.emails.send(
        { from: this.from, to: message.to, subject: message.subject, text: message.text },
        { idempotencyKey },
      );
      if (response.error) {
        const retryable =
          response.error.statusCode === null ||
          response.error.statusCode === 429 ||
          response.error.statusCode >= 500;
        throw {
          code: retryable ? 'provider_temporary' : 'provider_rejected',
          retryable,
        } satisfies EmailProviderError;
      }
      return { providerMessageId: response.data.id };
    } catch (error) {
      if (isEmailProviderError(error)) throw error;
      throw { code: 'provider_temporary', retryable: true } satisfies EmailProviderError;
    }
  }
}

export function isEmailProviderError(error: unknown): error is EmailProviderError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ['provider_temporary', 'provider_rejected', 'provider_configuration'].includes(
      String((error as { code: unknown }).code),
    ) &&
    typeof (error as { retryable?: unknown }).retryable === 'boolean'
  );
}
