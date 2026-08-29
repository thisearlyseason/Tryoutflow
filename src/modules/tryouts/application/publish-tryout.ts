import { z } from 'zod';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import { getPublicAppOrigin } from '../../../lib/env';
import type { OrganizationId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';

const publishInputSchema = z.object({
  organizationId: z.uuid(),
  tryoutId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
});

const validateInputSchema = publishInputSchema.omit({ expectedVersion: true });

export type PublishBlocker =
  | 'division_missing'
  | 'session_missing'
  | 'registration_form_missing'
  | 'registration_closed'
  | 'rubric_invalid';

export type PublishTryoutError = {
  code: PublishBlocker | 'invalid_input' | 'forbidden' | 'not_found' | 'conflict' | 'unexpected';
};

export type PublishTryoutOutcome =
  | { kind: 'published' | 'already_published'; publicSlug: string }
  | { kind: PublishBlocker | 'not_found' | 'conflict' | 'forbidden' | 'unexpected' };

export interface PublishTryoutGateway {
  publish(input: {
    organizationId: OrganizationId;
    tryoutId: string;
    expectedVersion: number;
  }): Promise<PublishTryoutOutcome>;
}

export interface ValidateTryoutForPublishGateway {
  validate(input: { organizationId: OrganizationId; tryoutId: string }): Promise<PublishBlocker[]>;
}

type RpcRow = { outcome?: unknown; public_slug?: unknown };
type ValidationRpcRow = { blocker?: unknown };
type RpcError = { code?: unknown } | null;

function isPublishBlocker(value: unknown): value is PublishBlocker {
  return (
    value === 'division_missing' ||
    value === 'session_missing' ||
    value === 'registration_form_missing' ||
    value === 'registration_closed' ||
    value === 'rubric_invalid'
  );
}

export function mapPublishTryoutResponse(data: unknown, error: RpcError): PublishTryoutOutcome {
  if (error?.code === '42501') return { kind: 'forbidden' };
  if (
    error ||
    !Array.isArray(data) ||
    data.length !== 1 ||
    typeof data[0] !== 'object' ||
    !data[0]
  ) {
    return { kind: 'unexpected' };
  }
  const row = data[0] as RpcRow;
  if (
    (row.outcome === 'published' || row.outcome === 'already_published') &&
    typeof row.public_slug === 'string'
  ) {
    return { kind: row.outcome, publicSlug: row.public_slug };
  }
  if (isPublishBlocker(row.outcome) || row.outcome === 'not_found' || row.outcome === 'conflict') {
    return { kind: row.outcome };
  }
  return { kind: 'unexpected' };
}

export function canonicalRegistrationUrl(origin: string, publicSlug: string): string {
  const safeOrigin = getPublicAppOrigin({
    NEXT_PUBLIC_APP_URL: origin,
    NODE_ENV: process.env.NODE_ENV,
  });
  const url = new URL(`/register/${encodeURIComponent(publicSlug)}`, safeOrigin);
  return url.toString().replace(/\/$/, '');
}

export async function publishTryout(
  input: unknown,
  actor: { authorization: AuthorizationContext },
  dependencies: { gateway?: PublishTryoutGateway; publicOrigin?: string } = {},
): Promise<AppResult<{ alreadyPublished: boolean; registrationUrl: string }, PublishTryoutError>> {
  const parsed = publishInputSchema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_input' });
  const organizationId = parsed.data.organizationId as OrganizationId;
  if (
    !requireCapability(actor.authorization, 'tryout:publish', {
      organizationId,
      tryoutId: parsed.data.tryoutId,
    }).ok
  ) {
    return failure({ code: 'forbidden' });
  }

  try {
    const outcome = await (dependencies.gateway ?? (await defaultPublishGateway())).publish({
      organizationId,
      tryoutId: parsed.data.tryoutId,
      expectedVersion: parsed.data.expectedVersion,
    });
    if (outcome.kind === 'published' || outcome.kind === 'already_published') {
      return success({
        alreadyPublished: outcome.kind === 'already_published',
        registrationUrl: canonicalRegistrationUrl(
          dependencies.publicOrigin ?? getPublicAppOrigin(),
          outcome.publicSlug,
        ),
      });
    }
    return failure({ code: outcome.kind });
  } catch {
    return failure({ code: 'unexpected' });
  }
}

export async function validateTryoutForPublish(
  input: unknown,
  actor: { authorization: AuthorizationContext },
  dependencies: { gateway?: ValidateTryoutForPublishGateway } = {},
): Promise<
  AppResult<{ blockers: PublishBlocker[] }, { code: 'invalid_input' | 'forbidden' | 'unexpected' }>
> {
  const parsed = validateInputSchema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_input' });
  const organizationId = parsed.data.organizationId as OrganizationId;
  if (
    !requireCapability(actor.authorization, 'tryout:publish', {
      organizationId,
      tryoutId: parsed.data.tryoutId,
    }).ok
  ) {
    return failure({ code: 'forbidden' });
  }
  try {
    const blockers = await (dependencies.gateway ?? (await defaultPublishGateway())).validate({
      organizationId,
      tryoutId: parsed.data.tryoutId,
    });
    return success({ blockers });
  } catch {
    return failure({ code: 'unexpected' });
  }
}

async function defaultPublishGateway(): Promise<
  PublishTryoutGateway & ValidateTryoutForPublishGateway
> {
  const client = await createServerSupabaseClient();
  return {
    async publish(input) {
      const { data, error } = await client.rpc('publish_tryout', {
        p_organization_id: input.organizationId,
        p_tryout_id: input.tryoutId,
        p_expected_version: input.expectedVersion,
      });
      return mapPublishTryoutResponse(data, error);
    },
    async validate(input) {
      const { data, error } = await client.rpc('validate_tryout_for_publish', {
        p_organization_id: input.organizationId,
        p_tryout_id: input.tryoutId,
      });
      if (error || !Array.isArray(data))
        throw error ?? new Error('Invalid publish validation response');
      return data.map((row) => (row as ValidationRpcRow).blocker).filter(isPublishBlocker);
    },
  };
}
