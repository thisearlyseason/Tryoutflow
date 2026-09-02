import { createHash } from 'node:crypto';

import { z } from 'zod';

import { captureOperationalError } from '../../../../../infrastructure/observability/server-observability';
import { createAdminSupabaseClient } from '../../../../../infrastructure/supabase/admin';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const logoRowSchema = z.object({
  content: z.string().regex(/^\\x(?:[0-9a-f]{2})+$/u),
  content_type: z.literal('image/webp'),
  byte_length: z.number().int().min(12).max(350_000),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  updated_at: z.string().min(1),
});
const logoRowsSchema = z.array(logoRowSchema).max(1);

const representationCacheControl = 'public, max-age=0, must-revalidate';

function unavailable(outcome: 'not_found' | 'unavailable') {
  return new Response(
    outcome === 'not_found' ? 'Logo unavailable.' : 'Logo temporarily unavailable.',
    {
      status: outcome === 'not_found' ? 404 : 503,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
        'x-content-type-options': 'nosniff',
      },
    },
  );
}

function validWebp(bytes: Uint8Array) {
  return (
    bytes.byteLength >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
  );
}

export async function GET(
  request: Request,
  { params }: RouteContext<'/api/organizations/[organizationSlug]/logo'>,
) {
  const { organizationSlug } = await params;
  if (
    organizationSlug.length < 1 ||
    organizationSlug.length > 63 ||
    !slugPattern.test(organizationSlug)
  ) {
    return unavailable('not_found');
  }

  try {
    const result = await createAdminSupabaseClient().rpc('read_organization_logo_service', {
      p_organization_slug: organizationSlug,
    });
    if (result.error) {
      captureOperationalError(result.error, { operation: 'organization.logo.read' });
      return unavailable('unavailable');
    }
    const parsed = logoRowsSchema.safeParse(result.data);
    if (!parsed.success) {
      captureOperationalError(new Error('invalid organization logo service response'), {
        operation: 'organization.logo.read',
      });
      return unavailable('unavailable');
    }
    const [logo] = parsed.data;
    if (!logo) return unavailable('not_found');

    const bytes = Buffer.from(logo.content.slice(2), 'hex');
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (bytes.byteLength !== logo.byte_length || !validWebp(bytes) || digest !== logo.sha256) {
      captureOperationalError(new Error('invalid organization logo service response'), {
        operation: 'organization.logo.read',
      });
      return unavailable('unavailable');
    }

    const etag = `"${logo.sha256}"`;
    const sharedHeaders = {
      'cache-control': representationCacheControl,
      etag,
      'x-content-type-options': 'nosniff',
    };
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: sharedHeaders });
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        ...sharedHeaders,
        'content-length': String(bytes.byteLength),
        'content-type': 'image/webp',
      },
    });
  } catch (error) {
    captureOperationalError(error, { operation: 'organization.logo.read' });
    return unavailable('unavailable');
  }
}
