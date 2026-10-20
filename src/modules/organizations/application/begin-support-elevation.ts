import type { Clock } from '../../../lib/clock';
import type { OrganizationId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';

export type SupportElevationOutcome =
  'started' | 'forbidden' | 'invalid_reason' | 'invalid_expiry' | 'not_found' | 'conflict';

export type SupportElevationGatewayResult = Readonly<{
  outcome: SupportElevationOutcome;
  elevationId: string | null;
  expiresAt: string | null;
}>;

export interface SupportElevationGateway {
  begin(
    input: Readonly<{
      organizationId: OrganizationId;
      reason: string;
      expiresAt: Date;
    }>,
  ): Promise<SupportElevationGatewayResult>;
}

export type BeginSupportElevationError = Readonly<{
  code: Exclude<SupportElevationOutcome, 'started'> | 'support_unavailable';
}>;

export async function beginSupportElevation(
  input: Readonly<{ organizationId: OrganizationId; reason: string; expiresAt: Date }>,
  gateway: SupportElevationGateway,
  clock: Clock,
): Promise<
  AppResult<Readonly<{ elevationId: string; expiresAt: string }>, BeginSupportElevationError>
> {
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 500 || /[\p{Cc}\p{Cf}]/u.test(reason)) {
    return failure({ code: 'invalid_reason' });
  }
  const now = clock.now().getTime();
  const expiresAt = input.expiresAt.getTime();
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt < now + 5 * 60_000 ||
    expiresAt > now + 4 * 60 * 60_000
  ) {
    return failure({ code: 'invalid_expiry' });
  }
  try {
    const result = await gateway.begin({
      organizationId: input.organizationId,
      reason,
      expiresAt: new Date(expiresAt),
    });
    if (result.outcome !== 'started') return failure({ code: result.outcome });
    if (!result.elevationId || !result.expiresAt) {
      return failure({ code: 'support_unavailable' });
    }
    return success({ elevationId: result.elevationId, expiresAt: result.expiresAt });
  } catch {
    return failure({ code: 'support_unavailable' });
  }
}
