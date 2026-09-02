import { z } from 'zod';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import type { OrganizationId, UserId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from './capabilities';
import {
  normalizeOrganizationLogo,
  OrganizationLogoNormalizationError,
  type NormalizedOrganizationLogo,
} from './normalize-organization-logo';
import { requireCapability } from './require-capability';

export type LogoMutation =
  Readonly<{ kind: 'updated'; sha256: string; byteLength: number }> | Readonly<{ kind: 'removed' }>;

export type LogoError = Readonly<{
  code: 'invalid_file' | 'forbidden' | 'too_large' | 'unavailable';
}>;

export type OrganizationLogoGateway = {
  upsert(
    input: Readonly<{
      organizationId: OrganizationId;
      base64: string;
      sha256: string;
    }>,
  ): Promise<string>;
  remove(input: Readonly<{ organizationId: OrganizationId }>): Promise<string>;
};

type LogoNormalizer = (file: File) => Promise<NormalizedOrganizationLogo>;

type LogoDependencies = {
  gateway?: OrganizationLogoGateway;
  normalize?: LogoNormalizer;
};

const organizationIdSchema = z.uuid();

async function defaultGateway(): Promise<OrganizationLogoGateway> {
  const client = await createServerSupabaseClient();
  return {
    async upsert(input) {
      const result = await client.rpc('upsert_organization_logo', {
        p_organization_id: input.organizationId,
        p_content_base64: input.base64,
        p_sha256: input.sha256,
      });
      if (result.error || typeof result.data !== 'string') {
        throw new Error('Organization logo upsert unavailable');
      }
      return result.data;
    },
    async remove(input) {
      const result = await client.rpc('remove_organization_logo', {
        p_organization_id: input.organizationId,
      });
      if (result.error || typeof result.data !== 'string') {
        throw new Error('Organization logo removal unavailable');
      }
      return result.data;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFile(value: unknown): value is File {
  return typeof File !== 'undefined' && value instanceof File;
}

export async function updateOrganizationLogo(
  input: unknown,
  actor: { userId: UserId; authorization: AuthorizationContext },
  dependencies: LogoDependencies = {},
): Promise<AppResult<LogoMutation, LogoError>> {
  if (!isRecord(input)) return failure({ code: 'invalid_file' });
  const parsedOrganizationId = organizationIdSchema.safeParse(input.organizationId);
  if (!parsedOrganizationId.success) return failure({ code: 'invalid_file' });
  const organizationId = parsedOrganizationId.data as OrganizationId;
  if (!requireCapability(actor.authorization, 'organization:update', { organizationId }).ok) {
    return failure({ code: 'forbidden' });
  }

  const remove = input.remove === true;
  if (!remove && !isFile(input.file)) return failure({ code: 'invalid_file' });
  if (remove && input.file !== undefined) return failure({ code: 'invalid_file' });
  const file: File | null = isFile(input.file) ? input.file : null;

  try {
    const gateway = dependencies.gateway ?? (await defaultGateway());
    if (remove) {
      const outcome = await gateway.remove({ organizationId });
      if (outcome === 'removed') return success({ kind: 'removed' });
      if (outcome === 'forbidden') return failure({ code: 'forbidden' });
      return failure({ code: 'unavailable' });
    }

    if (!file) return failure({ code: 'invalid_file' });
    const normalized = await (dependencies.normalize ?? normalizeOrganizationLogo)(file);
    const outcome = await gateway.upsert({
      organizationId,
      base64: normalized.base64,
      sha256: normalized.sha256,
    });
    if (outcome === 'forbidden') return failure({ code: 'forbidden' });
    if (outcome !== 'updated') return failure({ code: 'unavailable' });
    return success({
      kind: 'updated',
      sha256: normalized.sha256,
      byteLength: normalized.byteLength,
    });
  } catch (error) {
    if (error instanceof OrganizationLogoNormalizationError) {
      return failure({ code: error.code });
    }
    return failure({ code: 'unavailable' });
  }
}
