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

    if (payload.action === 'preview') {
      const mapping = mappingFrom(payload.mapping);
      if (typeof payload.content !== 'string' || !mapping)
        return responseError(400, 'invalid_request');
      const preview = await previewAthleteImport(
        { organizationId, content: payload.content, mapping, actor: authorization },
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
            return (athletesResult.data ?? []).flatMap((athlete) => {
              const guardianEmail = emailByAthlete.get(athlete.id);
              return guardianEmail
                ? [
                    {
                      athleteId: athlete.id,
                      givenName: athlete.given_name,
                      familyName: athlete.family_name,
                      birthDate: athlete.birth_date,
                      guardianEmail,
                    },
                  ]
                : [];
            });
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
