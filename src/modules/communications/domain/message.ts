import { z } from 'zod';

export const communicationCommandSchema = z
  .object({
    organizationId: z.uuid(),
    registrationId: z.uuid(),
    guardianId: z.uuid(),
    messageKind: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/u),
    noticeClass: z.enum(['operational', 'optional']),
    subject: z.string().min(1).max(200),
    text: z.string().min(1).max(20_000),
    businessIdempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{16,200}$/u),
  })
  .strict();

export type CommunicationCommand = z.infer<typeof communicationCommandSchema>;
export type QueueCommunicationResult =
  | { outcome: 'queued' | 'replayed'; messageId: string; jobId: string }
  | { outcome: 'suppressed' | 'forbidden' | 'invalid_input' | 'idempotency_conflict' };
