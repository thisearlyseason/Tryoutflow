import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { Database } from '../../../infrastructure/supabase/database.types';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';

export type LiveDashboard = Readonly<{
  registrations: number;
  checkedIn: number;
  activeEvaluators: number;
  completedEvaluations: number;
  expectedEvaluations: number;
  syncNeedsAttention: number;
  generatedAt: string;
}>;

const inputSchema = z.strictObject({
  organizationId: z.uuid(),
  tryoutId: z.uuid(),
  divisionId: z.uuid().optional(),
  sessionId: z.uuid().optional(),
  groupId: z.uuid().optional(),
});
const dashboardSchema = z.strictObject({
  registrations: z.number().int().min(0).max(1_000_000),
  checkedIn: z.number().int().min(0).max(1_000_000),
  activeEvaluators: z.number().int().min(0).max(100_000),
  completedEvaluations: z.number().int().min(0).max(10_000_000),
  expectedEvaluations: z.number().int().min(0).max(10_000_000),
  syncNeedsAttention: z.number().int().min(0).max(10_000_000),
  generatedAt: z.iso.datetime({ offset: true }),
});
const responseSchema = z.strictObject({
  outcome: z.enum(['ok', 'forbidden', 'invalid_scope']),
  dashboard: dashboardSchema.optional(),
});

export function parseLiveDashboardResponse(input: unknown) {
  const parsed = responseSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid dashboard projection');
  if (parsed.data.outcome === 'ok') {
    if (!parsed.data.dashboard) throw new Error('Invalid dashboard projection');
    return { outcome: 'ok' as const, dashboard: parsed.data.dashboard };
  }
  if (parsed.data.dashboard) throw new Error('Invalid dashboard projection');
  return { outcome: parsed.data.outcome };
}

export type LiveDashboardGateway = {
  load(
    input: z.infer<typeof inputSchema>,
  ): Promise<
    { outcome: 'ok'; dashboard: LiveDashboard } | { outcome: 'forbidden' | 'invalid_scope' }
  >;
};

export class SupabaseLiveDashboardGateway implements LiveDashboardGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async load(input: z.infer<typeof inputSchema>) {
    const { data, error } = await this.client.rpc('load_live_dashboard', {
      p_organization_id: input.organizationId,
      p_tryout_id: input.tryoutId,
      p_division_id: input.divisionId,
      p_session_id: input.sessionId,
      p_group_id: input.groupId,
    });
    if (error || !Array.isArray(data) || data.length !== 1)
      throw error ?? new Error('Invalid dashboard projection');
    return parseLiveDashboardResponse(data[0]?.result);
  }
}

export async function getLiveDashboard(
  input: unknown,
  actor: AuthorizationContext,
  gateway: LiveDashboardGateway,
): Promise<AppResult<LiveDashboard, { code: 'invalid_input' | 'forbidden' | 'unexpected' }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_input' });
  if (
    actor.organizationId !== parsed.data.organizationId ||
    actor.membershipStatus !== 'active' ||
    !(
      ['owner', 'administrator'].includes(actor.organizationRole) ||
      actor.assignments.some(
        (assignment) =>
          assignment.role === 'director' && assignment.scope.tryoutId === parsed.data.tryoutId,
      )
    )
  )
    return failure({ code: 'forbidden' });
  try {
    const result = await gateway.load(parsed.data);
    return result.outcome === 'ok' ? success(result.dashboard) : failure({ code: 'forbidden' });
  } catch {
    return failure({ code: 'unexpected' });
  }
}
