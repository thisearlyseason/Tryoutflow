import 'server-only';

import { createPrivateKey, randomUUID, sign } from 'node:crypto';

import { z } from 'zod';

import {
  digestValue,
  evaluationDraftSchema,
  evaluationScopeSchema,
  type AuthoritativeEvaluationSnapshotProof,
  type EvaluationDraftPayload,
  type EvaluationStorageScope,
} from '../offline/database';
import { authoritativeSnapshotProofClaims } from '../offline/authoritative-snapshot-proof';

const PROOF_LIFETIME_MS = 2 * 60 * 1_000;

/**
 * Mint a short-lived, one-render nonce from the authenticated server boundary. The browser stores
 * this exact binding before it may discard local work. The nonce contract prevents stale tabs and
 * caller-supplied freshness booleans; it does not attempt to defend against compromised same-origin
 * JavaScript, which already controls that origin's IndexedDB.
 */
export async function issueAuthoritativeSnapshotProof(input: {
  scope: EvaluationStorageScope;
  evaluationId: string;
  version: number;
  draft: EvaluationDraftPayload;
  now?: Date;
}): Promise<AuthoritativeEvaluationSnapshotProof> {
  const now = input.now ?? new Date();
  const scope = evaluationScopeSchema.parse(input.scope);
  const evaluationId = z.uuid().parse(input.evaluationId);
  const version = z.number().int().min(1).max(2_147_483_646).parse(input.version);
  const draft = evaluationDraftSchema.parse(input.draft);
  const unsigned = {
    renderNonce: randomUUID(),
    scope,
    evaluationId,
    version,
    draftDigest: await digestValue(draft),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PROOF_LIFETIME_MS).toISOString(),
  };
  const encodedPrivateKey = process.env.EVALUATION_SNAPSHOT_PROOF_PRIVATE_JWK;
  if (!encodedPrivateKey) throw new Error('EVALUATION_SNAPSHOT_PROOF_PRIVATE_JWK is required.');
  const parsed: unknown = JSON.parse(encodedPrivateKey);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as JsonWebKey).kty !== 'EC' ||
    (parsed as JsonWebKey).crv !== 'P-256' ||
    typeof (parsed as JsonWebKey).d !== 'string'
  )
    throw new Error('EVALUATION_SNAPSHOT_PROOF_PRIVATE_JWK must be a private P-256 JWK.');
  const signature = sign('sha256', authoritativeSnapshotProofClaims(unsigned), {
    key: createPrivateKey({ key: parsed as JsonWebKey, format: 'jwk' }),
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return { ...unsigned, signature };
}
