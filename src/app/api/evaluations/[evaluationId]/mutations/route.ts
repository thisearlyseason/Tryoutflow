import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '../../../../../infrastructure/supabase/server';
import { parseOrganizationId, parseUserId } from '../../../../../lib/ids';
import {
  evaluationMutationSchema,
  syncEvaluationMutation,
} from '../../../../../modules/evaluations/application/sync-evaluation-mutation';
import { SupabaseMembershipRepository } from '../../../../../modules/organizations/infrastructure/membership-repository';

const MAX_REQUEST_BYTES = 128 * 1_024;
const routeBodySchema = evaluationMutationSchema.omit({ evaluationId: true });

function error(status: number, code: string) {
  return NextResponse.json({ error: code }, { status });
}

async function readJson(request: NextRequest): Promise<unknown> {
  const mime = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mime !== 'application/json') throw { status: 415 };
  const host = request.headers.get('host');
  const forwardedProtocol = request.headers
    .get('x-forwarded-proto')
    ?.split(',', 1)[0]
    ?.trim()
    .toLowerCase();
  const protocol =
    forwardedProtocol === 'http' || forwardedProtocol === 'https'
      ? forwardedProtocol
      : new URL(request.url).protocol.slice(0, -1);
  const expectedOrigin =
    host && /^[A-Za-z0-9.:[\]-]+$/u.test(host)
      ? `${protocol}://${host}`
      : new URL(request.url).origin;
  if (request.headers.get('origin') !== expectedOrigin) throw { status: 403 };
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const announced = Number(contentLength);
    if (!Number.isSafeInteger(announced) || announced < 0) throw { status: 400 };
    if (announced > MAX_REQUEST_BYTES) throw { status: 413 };
  }
  if (!request.body) throw { status: 400 };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw { status: 413 };
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw { status: 400 };
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ evaluationId: string }> },
) {
  try {
    const evaluationId = z.uuid().parse((await params).evaluationId);
    const body = routeBodySchema.safeParse(await readJson(request));
    if (!body.success) return error(400, 'invalid_request');
    const client = await createServerSupabaseClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return error(401, 'unauthorized');
    const userId = parseUserId(user.id);
    const organizationId = parseOrganizationId(body.data.scope.organizationId);
    const actor = await new SupabaseMembershipRepository(client).findAuthorizationContext(
      userId,
      organizationId,
    );
    if (!actor) return error(403, 'forbidden');
    const result = await syncEvaluationMutation({ ...body.data, evaluationId }, actor);
    if (!result.ok) {
      const status =
        result.error.code === 'forbidden'
          ? 403
          : result.error.code === 'mutation_id_conflict'
            ? 409
            : result.error.code === 'invalid_input'
              ? 400
              : 503;
      return error(status, result.error.code);
    }
    return NextResponse.json({ receipt: result.value });
  } catch (caught) {
    if (caught instanceof z.ZodError) return error(400, 'invalid_request');
    const status =
      typeof caught === 'object' && caught !== null && 'status' in caught
        ? Number((caught as { status: unknown }).status)
        : 503;
    return [400, 403, 413, 415].includes(status)
      ? error(status, 'invalid_request')
      : error(503, 'temporarily_unavailable');
  }
}
