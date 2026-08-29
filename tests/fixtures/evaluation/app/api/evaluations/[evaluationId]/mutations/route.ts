import { NextResponse } from 'next/server';

import { evaluationMutationSchema } from '../../../../../../../../src/modules/evaluations/application/evaluation-mutation-contract';
import {
  digestValue,
  evaluationPayload,
} from '../../../../../../../../src/modules/evaluations/offline/database';
import { recordAuthoritativeEvaluationId } from '../../../../../lib/authoritative-evaluation-state';

const receipts = new Map<string, Record<string, unknown>>();
const versions = new Map<string, number>();
const forcedConflicts = new Set<string>();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ evaluationId: string }> },
) {
  const mutation = evaluationMutationSchema.safeParse({
    ...((await request.json()) as object),
    evaluationId: (await params).evaluationId,
  });
  if (!mutation.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const prior = receipts.get(mutation.data.clientMutationId);
  if (prior) return NextResponse.json({ receipt: prior });
  const engine = request.headers.get('user-agent')?.includes('Chrome') ? 'chromium' : 'webkit';
  const serverKey = `${mutation.data.evaluationId}:${engine}`;
  const forcedKey = `${mutation.data.scope.registrationId}:${engine}`;
  const payloadDigest = await digestValue(
    evaluationPayload(
      mutation.data.scope,
      mutation.data.evaluationId,
      mutation.data.expectedVersion,
      mutation.data.draft,
    ),
  );
  const current =
    versions.get(serverKey) ??
    ([
      'fefefefe-fefe-4efe-8efe-fefefefefefe',
      'fdfdfdfd-fdfd-4dfd-8dfd-fdfdfdfdfdfd',
      'edededed-eded-4ede-8ede-edededededed',
      'dcdcdcdc-dcdc-4dcd-8dcd-dcdcdcdcdcdc',
    ].includes(mutation.data.evaluationId)
      ? 1
      : 0);
  const forceOnce =
    mutation.data.draft.note?.startsWith('force durable conflict') &&
    !forcedConflicts.has(forcedKey);
  if (forceOnce) forcedConflicts.add(forcedKey);
  const remappedEvaluationId =
    mutation.data.scope.registrationId === 'abababab-abab-4bab-8bab-abababababab'
      ? 'edededed-eded-4ede-8ede-edededededed'
      : mutation.data.scope.registrationId === 'acacacac-acac-4cac-8cac-acacacacacac'
        ? 'dcdcdcdc-dcdc-4dcd-8dcd-dcdcdcdcdcdc'
        : mutation.data.evaluationId;
  if (forceOnce) {
    recordAuthoritativeEvaluationId(
      mutation.data.scope.registrationId,
      engine,
      remappedEvaluationId,
    );
  }
  const outcome =
    mutation.data.draft.note === 'force server conflict' ||
    forceOnce ||
    mutation.data.expectedVersion !== current
      ? 'conflict'
      : 'synced';
  const serverVersion = outcome === 'synced' ? current + 1 : current || null;
  if (outcome === 'synced') versions.set(serverKey, serverVersion as number);
  const receipt = {
    outcome,
    clientMutationId: mutation.data.clientMutationId,
    evaluationId: mutation.data.evaluationId,
    ...(outcome === 'conflict'
      ? { serverEvaluationId: forceOnce ? remappedEvaluationId : mutation.data.evaluationId }
      : {}),
    expectedVersion: mutation.data.expectedVersion,
    payloadDigest,
    serverVersion,
    acknowledgedAt: new Date().toISOString(),
  };
  receipts.set(mutation.data.clientMutationId, receipt);
  return NextResponse.json({ receipt });
}
