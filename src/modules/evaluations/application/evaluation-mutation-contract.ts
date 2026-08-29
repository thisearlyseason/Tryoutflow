import { z } from 'zod';
import { isJsonPostgresCompatibleString } from '../../../lib/json-string-contract';

const uuid = z.uuid();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const scopeSchema = z.strictObject({
  userId: uuid,
  evaluatorId: uuid,
  organizationId: uuid,
  tryoutId: uuid,
  sessionId: uuid,
  registrationId: uuid,
  rubricVersionId: uuid,
});
const draftSchema = z.strictObject({
  scores: z
    .array(z.strictObject({ categoryId: uuid, value: z.number().int().min(1).max(10) }))
    .max(50)
    .refine((rows) => new Set(rows.map((row) => row.categoryId)).size === rows.length),
  note: z.string().max(4_000).refine(isJsonPostgresCompatibleString).optional(),
  noteTagIds: z
    .array(uuid)
    .max(25)
    .refine((rows) => new Set(rows).size === rows.length),
  flags: z
    .array(z.enum(['needs_another_look', 'injury_concern', 'eligibility_review']))
    .max(3)
    .refine((rows) => new Set(rows).size === rows.length),
});

export const evaluationMutationSchema = z.strictObject({
  scope: scopeSchema,
  evaluationId: uuid,
  clientMutationId: uuid,
  expectedVersion: z.number().int().min(0).max(2_147_483_646),
  draft: draftSchema,
});

export const evaluationMutationReceiptSchema = z.strictObject({
  outcome: z.enum([
    'synced',
    'conflict',
    'forbidden',
    'invalid_context',
    'invalid_score',
    'invalid_note_tag',
    'invalid_rubric',
    'locked',
  ]),
  clientMutationId: uuid,
  evaluationId: uuid,
  expectedVersion: z.number().int().min(0),
  payloadDigest: sha256,
  serverVersion: z.number().int().min(1).nullable(),
  acknowledgedAt: z.iso.datetime({ offset: true }),
});

export type EvaluationMutation = z.infer<typeof evaluationMutationSchema>;
export type EvaluationMutationReceipt = z.infer<typeof evaluationMutationReceiptSchema>;
