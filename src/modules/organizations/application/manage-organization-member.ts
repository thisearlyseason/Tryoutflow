import { z } from 'zod';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import type { OrganizationId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from './capabilities';
import { requireCapability } from './require-capability';

const changeSchema = z.strictObject({
  organizationId: z.uuid(),
  memberId: z.uuid(),
  role: z.enum(['administrator', 'member']),
  status: z.enum(['active', 'disabled']),
  expectedVersion: z.int().nonnegative(),
  idempotencyKey: z.uuid(),
});

const transferSchema = z.strictObject({
  organizationId: z.uuid(),
  targetMemberId: z.uuid(),
  expectedActorVersion: z.int().nonnegative(),
  expectedTargetVersion: z.int().nonnegative(),
  idempotencyKey: z.uuid(),
});

type MembershipCommandError = {
  code: 'invalid_input' | 'forbidden' | 'not_found' | 'conflict' | 'unavailable';
};

export type MembershipCommandGateway = {
  change(input: z.infer<typeof changeSchema>): Promise<{
    outcome: string;
    memberId?: string;
    role?: string;
    status?: string;
    version?: number;
  }>;
  transfer(input: z.infer<typeof transferSchema>): Promise<{
    outcome: string;
    formerOwnerMemberId?: string;
    newOwnerMemberId?: string;
  }>;
};

async function defaultGateway(): Promise<MembershipCommandGateway> {
  const client = await createServerSupabaseClient();
  return {
    async change(input) {
      const result = await client.rpc('change_organization_member', {
        p_organization_id: input.organizationId,
        p_member_id: input.memberId,
        p_role: input.role,
        p_status: input.status,
        p_expected_version: input.expectedVersion,
        p_idempotency_key: input.idempotencyKey,
      });
      const row = result.data?.[0];
      if (result.error || !row) throw result.error ?? new Error('Membership command failed');
      return {
        outcome: row.outcome,
        memberId: row.member_id,
        role: row.role,
        status: row.status,
        version: row.version,
      };
    },
    async transfer(input) {
      const result = await client.rpc('transfer_organization_ownership', {
        p_organization_id: input.organizationId,
        p_target_member_id: input.targetMemberId,
        p_expected_actor_version: input.expectedActorVersion,
        p_expected_target_version: input.expectedTargetVersion,
        p_idempotency_key: input.idempotencyKey,
      });
      const row = result.data?.[0];
      if (result.error || !row) throw result.error ?? new Error('Ownership transfer failed');
      return {
        outcome: row.outcome,
        formerOwnerMemberId: row.former_owner_member_id,
        newOwnerMemberId: row.new_owner_member_id,
      };
    },
  };
}

function outcomeFailure(outcome: string): AppResult<never, MembershipCommandError> {
  switch (outcome) {
    case 'invalid':
      return failure({ code: 'invalid_input' });
    case 'forbidden':
      return failure({ code: 'forbidden' });
    case 'not_found':
      return failure({ code: 'not_found' });
    case 'conflict':
      return failure({ code: 'conflict' });
    default:
      return failure({ code: 'unavailable' });
  }
}

export async function changeOrganizationMember(
  input: unknown,
  actor: { authorization: AuthorizationContext },
  dependencies: { gateway?: MembershipCommandGateway } = {},
): Promise<
  AppResult<
    {
      memberId: string;
      role: 'administrator' | 'member';
      status: 'active' | 'disabled';
      version: number;
    },
    MembershipCommandError
  >
> {
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_input' });
  const organizationId = parsed.data.organizationId as OrganizationId;
  if (!requireCapability(actor.authorization, 'membership:manage', { organizationId }).ok)
    return failure({ code: 'forbidden' });
  try {
    const result = await (dependencies.gateway ?? (await defaultGateway())).change(parsed.data);
    if (result.outcome !== 'updated') return outcomeFailure(result.outcome);
    const output = z
      .strictObject({
        memberId: z.uuid(),
        role: z.enum(['administrator', 'member']),
        status: z.enum(['active', 'disabled']),
        version: z.int().nonnegative(),
      })
      .safeParse({
        memberId: result.memberId,
        role: result.role,
        status: result.status,
        version: result.version,
      });
    return output.success ? success(output.data) : failure({ code: 'unavailable' });
  } catch {
    return failure({ code: 'unavailable' });
  }
}

export async function transferOrganizationOwnership(
  input: unknown,
  actor: { authorization: AuthorizationContext },
  dependencies: { gateway?: MembershipCommandGateway } = {},
): Promise<
  AppResult<{ formerOwnerMemberId: string; newOwnerMemberId: string }, MembershipCommandError>
> {
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_input' });
  const organizationId = parsed.data.organizationId as OrganizationId;
  if (
    actor.authorization.organizationRole !== 'owner' ||
    !requireCapability(actor.authorization, 'membership:manage', { organizationId }).ok
  )
    return failure({ code: 'forbidden' });
  try {
    const result = await (dependencies.gateway ?? (await defaultGateway())).transfer(parsed.data);
    if (result.outcome !== 'transferred') return outcomeFailure(result.outcome);
    const output = z
      .strictObject({
        formerOwnerMemberId: z.uuid(),
        newOwnerMemberId: z.uuid(),
      })
      .safeParse({
        formerOwnerMemberId: result.formerOwnerMemberId,
        newOwnerMemberId: result.newOwnerMemberId,
      });
    return output.success ? success(output.data) : failure({ code: 'unavailable' });
  } catch {
    return failure({ code: 'unavailable' });
  }
}
