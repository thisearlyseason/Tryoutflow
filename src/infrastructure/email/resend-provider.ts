import 'server-only';

import { z } from 'zod';

import {
  providerMessageIdSchema,
  type EmailMessage,
  type EmailProvider,
  type EmailProviderError,
} from './email-provider';

const configurationSchema = z.object({
  apiKey: z.string().min(20).max(300),
  from: z.email().max(320),
  timeoutMs: z.number().int().min(1_000).max(60_000).default(45_000),
});

const providerResponseSchema = z.object({ id: providerMessageIdSchema }).strict();

type ResendFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class ResendEmailProvider implements EmailProvider {
  private readonly apiKey: string;
  private readonly request: ResendFetch;
  private readonly from: string;
  private readonly timeoutMs: number;

  constructor(configuration: unknown, request: ResendFetch = fetch) {
    const parsed = configurationSchema.safeParse(configuration);
    if (!parsed.success) {
      throw { code: 'provider_configuration', retryable: false } satisfies EmailProviderError;
    }
    this.apiKey = parsed.data.apiKey;
    this.from = parsed.data.from;
    this.timeoutMs = parsed.data.timeoutMs;
    this.request = request;
  }

  async send(message: EmailMessage, idempotencyKey: string, options?: { signal?: AbortSignal }) {
    try {
      const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
      const signal = options?.signal
        ? AbortSignal.any([options.signal, timeoutSignal])
        : timeoutSignal;
      const response = await this.request('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({
          from: this.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
        }),
        signal,
      });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        throw {
          code: retryable ? 'provider_temporary' : 'provider_rejected',
          retryable,
        } satisfies EmailProviderError;
      }
      const providerResponse = providerResponseSchema.safeParse((await response.json()) as unknown);
      if (!providerResponse.success) {
        throw { code: 'delivery_uncertain', retryable: false } satisfies EmailProviderError;
      }
      return { providerMessageId: providerResponse.data.id };
    } catch (error) {
      if (isEmailProviderError(error)) throw error;
      throw { code: 'delivery_uncertain', retryable: false } satisfies EmailProviderError;
    }
  }
}

export function isEmailProviderError(error: unknown): error is EmailProviderError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    [
      'provider_temporary',
      'provider_rejected',
      'provider_configuration',
      'delivery_uncertain',
    ].includes(String((error as { code: unknown }).code)) &&
    typeof (error as { retryable?: unknown }).retryable === 'boolean'
  );
}
