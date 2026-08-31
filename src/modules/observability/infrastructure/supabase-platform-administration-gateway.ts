import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../../infrastructure/supabase/database.types';
import type { SupportElevationGateway } from '../../organizations/application/begin-support-elevation';
import type { DetailedHealth } from '../application/health-check';
import { AppError } from '../domain/app-error';
import type {
  PlatformOrganization,
  PlatformSubscription,
  VisibleAuditEvent,
  VisibleSupportElevation,
} from '../ui/platform-administration';

function platformFailure(error?: unknown): AppError {
  const databaseCode =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  if (databaseCode === '42501') {
    return new AppError('platform_forbidden');
  }
  return new AppError('platform_unavailable');
}

function requireData<T>(result: { data: T | null; error: unknown }): T {
  if (result.error || result.data === null) throw platformFailure(result.error);
  return result.data;
}

function count(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw platformFailure();
  return value;
}

export class SupabasePlatformAdministrationGateway implements SupportElevationGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async health(): Promise<DetailedHealth> {
    const rows = requireData(await this.client.rpc('platform_health'));
    const row = rows[0];
    if (!row || row.database_status !== 'ok') throw platformFailure();
    return {
      database: 'ok',
      failedJobs: count(row.failed_jobs),
      webhookFailures: count(row.webhook_failures),
      communicationFailures: count(row.communication_failures),
      integrationFailures: count(row.integration_failures),
      synchronizationProblems: count(row.synchronization_problems),
    };
  }

  async listOrganizations(limit = 50): Promise<readonly PlatformOrganization[]> {
    const rows = requireData(
      await this.client.rpc('platform_list_organizations', { p_limit: limit }),
    );
    return rows.map((row) => ({
      id: row.organization_id,
      name: row.organization_name,
      slug: row.organization_slug,
      status: row.organization_status,
      createdAt: row.organization_created_at,
    }));
  }

  async listSubscriptions(limit = 50): Promise<readonly PlatformSubscription[]> {
    const rows = requireData(
      await this.client.rpc('platform_list_subscriptions', { p_limit: limit }),
    );
    return rows.map((row) => ({
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      organizationSlug: row.organization_slug,
      plan: row.plan_key,
      state: row.subscription_state,
      currentPeriodEnd: row.current_period_end,
      cancelAtPeriodEnd: row.cancel_at_period_end,
      trialEnd: row.trial_end,
      verifiedAt: row.verified_at,
    }));
  }

  async listAuditEvents(limit = 50): Promise<readonly VisibleAuditEvent[]> {
    const rows = requireData(
      await this.client.rpc('platform_list_audit_events', { p_limit: limit }),
    );
    return rows.map((row) => ({
      id: row.audit_id,
      organizationId: row.organization_id,
      organizationSlug: row.organization_slug,
      actorId: row.actor_user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      occurredAt: row.occurred_at,
    }));
  }

  async listSupportElevations(limit = 50): Promise<readonly VisibleSupportElevation[]> {
    const rows = requireData(
      await this.client.rpc('platform_list_support_elevations', { p_limit: limit }),
    );
    return rows.map((row) => ({
      id: row.elevation_id,
      organizationId: row.organization_id,
      organizationSlug: row.organization_slug,
      supportUserId: row.support_user_id,
      reason: row.reason,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    }));
  }

  async begin(input: Parameters<SupportElevationGateway['begin']>[0]) {
    const rows = requireData(
      await this.client.rpc('begin_support_elevation', {
        p_organization_id: input.organizationId,
        p_reason: input.reason,
        p_expires_at: input.expiresAt.toISOString(),
      }),
    );
    const row = rows[0];
    if (!row) throw platformFailure();
    if (
      ![
        'started',
        'forbidden',
        'invalid_reason',
        'invalid_expiry',
        'not_found',
        'conflict',
      ].includes(row.outcome)
    ) {
      throw platformFailure();
    }
    return {
      outcome: row.outcome as Awaited<ReturnType<SupportElevationGateway['begin']>>['outcome'],
      elevationId: row.elevation_id,
      expiresAt: row.expires_at,
    };
  }
}
