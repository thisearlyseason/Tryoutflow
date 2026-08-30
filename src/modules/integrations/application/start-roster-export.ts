import { z } from 'zod';

import { can, type AuthorizationContext } from '../../organizations/application/capabilities';
import { parseOrganizationId } from '../../../lib/ids';

const token = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/u);
const startRosterExportInputSchema = z.strictObject({
  organizationId: z.uuid(),
  previewId: token,
  confirmationToken: token,
  idempotencyKey: token,
});

export type StartRosterExportInput = z.input<typeof startRosterExportInputSchema>;
export type StartRosterExportResult =
  | {
      outcome: 'queued' | 'replayed' | 'completed';
      jobId: string;
      state: string;
      itemCount: number;
      completedCount: number;
      skippedCount: number;
      failedCount: number;
    }
  | {
      outcome:
        | 'invalid_input'
        | 'forbidden'
        | 'not_found'
        | 'stale'
        | 'conflict'
        | 'already_consumed'
        | 'unavailable';
    };

export type StartRosterExportGateway = Readonly<{
  confirmPreview(input: {
    organizationId: string;
    actorId: string;
    previewId: string;
    confirmationToken: string;
    idempotencyKey: string;
  }): Promise<Exclude<StartRosterExportResult, { outcome: 'invalid_input' | 'unavailable' }>>;
}>;

export async function startRosterExport(
  input: StartRosterExportInput,
  actor: AuthorizationContext,
  dependencies: { gateway: StartRosterExportGateway },
): Promise<StartRosterExportResult> {
  const parsed = startRosterExportInputSchema.safeParse(input);
  if (!parsed.success) return { outcome: 'invalid_input' };
  if (
    !can(actor, 'integration:manage', {
      organizationId: parseOrganizationId(parsed.data.organizationId),
    })
  ) {
    return { outcome: 'forbidden' };
  }
  try {
    return await dependencies.gateway.confirmPreview({ ...parsed.data, actorId: actor.userId });
  } catch {
    return { outcome: 'unavailable' };
  }
}
