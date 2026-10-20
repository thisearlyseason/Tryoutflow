import { NextResponse, type NextRequest } from 'next/server';

import type { Json } from '../../../../../infrastructure/supabase/database.types';
import { createServerSupabaseClient } from '../../../../../infrastructure/supabase/server';
import { parseOrganizationId, parseUserId } from '../../../../../lib/ids';
import { commitAthleteImport } from '../../../../../modules/registration/application/commit-athlete-import';
import {
  previewAthleteImport,
  type AthleteImportPreview,
} from '../../../../../modules/registration/application/preview-athlete-import';
import type { CsvColumnMapping } from '../../../../../modules/registration/application/parse-athlete-csv';
import { requireCapability } from '../../../../../modules/organizations/application/require-capability';
import { SupabaseMembershipRepository } from '../../../../../modules/organizations/infrastructure/membership-repository';

// A 1 MiB CSV can expand when JSON escapes quotes and control characters.
// Keep the transport bounded while allowing the parser to enforce its tighter
// decoded-file limit.
const MAX_REQUEST_BYTES = 2_200_000;

function responseError(status: number, code: string) {
  return NextResponse.json({ error: code }, { status });
}

async function readBoundedJson(request: NextRequest): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json')
    throw { status: 415 };
  if (request.headers.get('origin') !== request.nextUrl.origin) throw { status: 403 };
  const announced = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(announced) && announced > MAX_REQUEST_BYTES) throw { status: 413 };
  if (!request.body) throw { status: 400 };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw { status: 413 };
    }
    chunks.push(chunk.value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
  } catch {
    throw { status: 400 };
  }
}

function mappingFrom(value: unknown): CsvColumnMapping | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const allowed = new Set([
    'givenName',
    'familyName',
    'birthDate',
    'guardianName',
    'guardianEmail',
    'guardianPhone',
  ]);
  if (Object.keys(source).some((key) => !allowed.has(key))) return null;
  if (
    typeof source.givenName !== 'string' ||
    typeof source.familyName !== 'string' ||
    typeof source.birthDate !== 'string'
  )
    return null;
  const optional = ['guardianName', 'guardianEmail', 'guardianPhone'] as const;
  if (optional.some((key) => source[key] !== undefined && typeof source[key] !== 'string'))
    return null;
  return {
    givenName: source.givenName,
    familyName: source.familyName,
    birthDate: source.birthDate,
    ...(typeof source.guardianName === 'string' ? { guardianName: source.guardianName } : {}),
    ...(typeof source.guardianEmail === 'string' ? { guardianEmail: source.guardianEmail } : {}),
    ...(typeof source.guardianPhone === 'string' ? { guardianPhone: source.guardianPhone } : {}),
  };
}

function decodeCsvBase64(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1_400_000) return null;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength > 1_048_576 || bytes.toString('base64') !== value) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseOrganizationId(rawOrganizationId);
    const client = await createServerSupabaseClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return responseError(401, 'unauthorized');
    const userId = parseUserId(user.id);
    const authorization = await new SupabaseMembershipRepository(client).findAuthorizationContext(
      userId,
      organizationId,
    );
    if (
      !authorization ||
      !requireCapability(authorization, 'athlete:write', { organizationId }).ok ||
      !['owner', 'administrator'].includes(authorization.organizationRole)
    )
      return responseError(403, 'forbidden');
    const body = await readBoundedJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return responseError(400, 'invalid_request');
    const payload = body as Record<string, unknown>;

    if (payload.action === 'load_preview') {
      if (typeof payload.previewId !== 'string') return responseError(400, 'invalid_request');
      const persisted = await client
        .from('athlete_import_previews')
        .select('id,organization_id,source_digest,column_mapping,preview_rows,expires_at')
        .eq('organization_id', organizationId)
        .eq('actor_user_id', userId)
        .eq('id', payload.previewId)
        .gt('expires_at', new Date().toISOString())
        .is('committed_at', null)
        .maybeSingle();
      if (persisted.error || !persisted.data) return responseError(404, 'preview_unavailable');
      return NextResponse.json({
        preview: {
          id: persisted.data.id,
          organizationId: persisted.data.organization_id,
          contentHash: persisted.data.source_digest,
          mapping: persisted.data.column_mapping,
          rows: persisted.data.preview_rows,
          expiresAt: persisted.data.expires_at,
        },
      });
    }

    if (payload.action === 'preview') {
      const mapping = mappingFrom(payload.mapping);
      const content = decodeCsvBase64(payload.contentBase64);
      if (content === null || !mapping) return responseError(400, 'invalid_request');
      const preview = await previewAthleteImport(
        { organizationId, content, mapping, actor: authorization },
        {
          async findExistingAthletes(targetOrganizationId) {
            const [athletesResult, linksResult] = await Promise.all([
              client
                .from('athletes')
                .select('id,given_name,family_name,birth_date')
                .eq('organization_id', targetOrganizationId),
              client
                .from('athlete_guardians')
                .select('athlete_id,guardians(normalized_email)')
                .eq('organization_id', targetOrganizationId)
                .eq('is_primary_contact', true),
            ]);
            if (athletesResult.error || linksResult.error) throw new Error('lookup_failed');
            const emailByAthlete = new Map(
              (linksResult.data ?? []).flatMap((link) =>
                link.guardians?.normalized_email
                  ? [[link.athlete_id, link.guardians.normalized_email] as const]
                  : [],
              ),
            );
            return (athletesResult.data ?? []).map((athlete) => ({
              athleteId: athlete.id,
              givenName: athlete.given_name,
              familyName: athlete.family_name,
              birthDate: athlete.birth_date,
              ...(emailByAthlete.has(athlete.id)
                ? { guardianEmail: emailByAthlete.get(athlete.id) }
                : {}),
            }));
          },
          async savePreview(candidate) {
            const result = await client.rpc('create_athlete_import_preview', {
              p_organization_id: organizationId,
              p_source_digest: candidate.contentHash,
              p_column_mapping: candidate.mapping as Json,
              p_preview_rows: JSON.parse(JSON.stringify(candidate.rows)) as Json,
            });
            const row = result.data?.[0];
            if (result.error || !row) throw new Error('preview_failed');
            return {
              ...candidate,
              id: row.preview_id,
              expiresAt: row.expires_at,
            } satisfies AthleteImportPreview;
          },
        },
      );
      return NextResponse.json({ preview });
    }

    if (payload.action === 'commit') {
      if (
        typeof payload.previewId !== 'string' ||
        !Array.isArray(payload.selectedRows) ||
        payload.selectedRows.some((row) => typeof row !== 'number')
      )
        return responseError(400, 'invalid_request');
      const result = await commitAthleteImport(
        {
          organizationId,
          previewId: payload.previewId,
          selectedRows: payload.selectedRows as number[],
          actor: authorization,
        },
        {
          async commit(input) {
            const committed = await client.rpc('commit_athlete_import', {
              p_organization_id: organizationId,
              p_preview_id: input.previewId,
              p_selected_rows: input.selectedRows,
            });
            const row = committed.data?.[0];
            if (committed.error || !row) throw new Error('commit_failed');
            if (row.outcome === 'committed' || row.outcome === 'replayed')
              return { outcome: row.outcome, athleteIds: row.athlete_ids ?? [] };
            return {
              outcome:
                row.outcome === 'expired' ||
                row.outcome === 'conflict' ||
                row.outcome === 'invalid_selection'
                  ? row.outcome
                  : 'invalid_selection',
              athleteIds: [],
            };
          },
        },
      );
      return NextResponse.json(
        { result },
        { status: result.outcome === 'committed' || result.outcome === 'replayed' ? 200 : 409 },
      );
    }
    if (payload.action === 'resolve_import_duplicate') {
      if (
        typeof payload.previewId !== 'string' ||
        typeof payload.row !== 'number' ||
        !Number.isSafeInteger(payload.row)
      )
        return responseError(400, 'invalid_request');
      const resolved = await client.rpc('resolve_athlete_import_duplicate', {
        p_organization_id: organizationId,
        p_preview_id: payload.previewId,
        p_row: payload.row,
        p_decision: 'keep_separate',
      });
      const outcome = resolved.data?.[0]?.outcome;
      if (resolved.error || outcome !== 'resolved')
        return responseError(409, 'resolution_conflict');
      return NextResponse.json({ outcome });
    }
    if (payload.action === 'resolve_registration_duplicate') {
      if (
        typeof payload.candidateId !== 'string' ||
        (payload.decision !== 'keep_separate' && payload.decision !== 'dismiss_candidate')
      )
        return responseError(400, 'invalid_request');
      const resolved = await client.rpc('resolve_registration_duplicate', {
        p_organization_id: organizationId,
        p_candidate_id: payload.candidateId,
        p_decision: payload.decision,
      });
      const outcome = resolved.data?.[0]?.outcome;
      if (resolved.error || outcome !== 'resolved')
        return responseError(409, 'resolution_conflict');
      return NextResponse.json({ outcome });
    }
    return responseError(400, 'invalid_request');
  } catch (error) {
    const status =
      error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
        ? error.status
        : error && typeof error === 'object' && 'code' in error && error.code === 'forbidden'
          ? 403
          : 400;
    return responseError(status, status === 413 ? 'request_too_large' : 'invalid_request');
  }
}
