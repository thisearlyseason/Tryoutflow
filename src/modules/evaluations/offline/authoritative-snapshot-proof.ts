import type { AuthoritativeEvaluationSnapshotProof } from './database';

const publicKeyEnvironmentName = 'NEXT_PUBLIC_EVALUATION_SNAPSHOT_PROOF_PUBLIC_JWK';

export function authoritativeSnapshotProofClaims(
  proof: Omit<AuthoritativeEvaluationSnapshotProof, 'signature'>,
): Uint8Array {
  const { scope } = proof;
  return new TextEncoder().encode(
    JSON.stringify([
      'tryoutflow-authoritative-evaluation-snapshot-v1',
      proof.renderNonce,
      scope.userId,
      scope.evaluatorId,
      scope.organizationId,
      scope.tryoutId,
      scope.sessionId,
      scope.registrationId,
      scope.rubricVersionId,
      proof.evaluationId,
      proof.version,
      proof.draftDigest,
      proof.issuedAt,
      proof.expiresAt,
    ]),
  );
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function readPublicKey(): JsonWebKey {
  const encoded = process.env.NEXT_PUBLIC_EVALUATION_SNAPSHOT_PROOF_PUBLIC_JWK;
  if (!encoded)
    throw new Error(`${publicKeyEnvironmentName} is required for destructive conflict recovery.`);
  const parsed: unknown = JSON.parse(encoded);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as JsonWebKey).kty !== 'EC' ||
    (parsed as JsonWebKey).crv !== 'P-256' ||
    typeof (parsed as JsonWebKey).x !== 'string' ||
    typeof (parsed as JsonWebKey).y !== 'string' ||
    'd' in parsed
  )
    throw new Error(`${publicKeyEnvironmentName} must be a public P-256 JWK.`);
  return parsed as JsonWebKey;
}

export async function verifyAuthoritativeSnapshotProof(
  proof: AuthoritativeEvaluationSnapshotProof,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      readPublicKey(),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      exactArrayBuffer(decodeBase64Url(proof.signature)),
      exactArrayBuffer(authoritativeSnapshotProofClaims(proof)),
    );
  } catch {
    return false;
  }
}
