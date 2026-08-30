import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  externalRosterDestinationSchema,
  finalizedRosterSnapshotSchema,
  rosterExportFieldSchema,
  rosterExportPreviewSchema,
  type ExternalRosterDestination,
  type RosterExportPreview,
} from '../domain/contracts';
import {
  normalizeTeamManagementProviderError,
  type TeamManagementProvider,
  type TeamManagementProviderError,
} from '../domain/provider';
import { can, type AuthorizationContext } from '../../organizations/application/capabilities';
import { parseOrganizationId } from '../../../lib/ids';

const previewInputSchema = z.strictObject({
  organizationId: z.uuid(),
  connectionId: z.uuid(),
  rosterVersionId: z.uuid(),
  destination: externalRosterDestinationSchema,
  approvedFields: z
    .array(rosterExportFieldSchema)
    .min(1)
    .max(7)
    .refine((fields) => new Set(fields).size === fields.length, 'fields must be unique'),
  correlationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/u),
});

export type PreviewRosterExportInput = Omit<
  z.input<typeof previewInputSchema>,
  'approvedFields'
> & {
  approvedFields: readonly z.infer<typeof rosterExportFieldSchema>[];
};

type PreviewContext = Readonly<{
  outcome: 'ok';
  providerKey: string;
  mockData: boolean;
  roster: z.infer<typeof finalizedRosterSnapshotSchema>;
  sourceId: string;
  sourceDigest: string;
  existingAthleteIds: readonly string[];
}>;

export type PreviewRosterExportGateway = Readonly<{
  issuePreviewSource(input: {
    organizationId: string;
    actorId: string;
    connectionId: string;
    rosterVersionId: string;
    destination: ExternalRosterDestination;
    approvedFields: z.infer<typeof rosterExportFieldSchema>[];
  }): Promise<
    PreviewContext | { outcome: 'forbidden' | 'not_found' | 'invalid_state' | 'invalid_input' }
  >;
  savePreview(input: {
    organizationId: string;
    actorId: string;
    connectionId: string;
    rosterVersionId: string;
    sourceId: string;
    sourceDigest: string;
    destination: ExternalRosterDestination;
    approvedFields: z.infer<typeof rosterExportFieldSchema>[];
    previewId: string;
    confirmationToken: string;
    snapshotDigest: string;
    payloadDigest: string;
    preview: RosterExportPreview;
  }): Promise<
    | { outcome: 'created' }
    | { outcome: 'replayed' }
    | { outcome: 'forbidden' }
    | { outcome: 'conflict' }
    | { outcome: 'stale' }
    | { outcome: 'not_found' }
  >;
}>;

export type PreviewRosterExportDependencies = Readonly<{
  gateway: PreviewRosterExportGateway;
  providers: { get(providerKey: string): TeamManagementProvider };
}>;

export type PreviewRosterExportResult =
  | ({ outcome: 'previewed' } & RosterExportPreview)
  | {
      outcome:
        | 'invalid_input'
        | 'forbidden'
        | 'not_found'
        | 'invalid_state'
        | 'conflict'
        | 'stale'
        | 'connection_error'
        | 'unavailable';
      error?: TeamManagementProviderError;
    };

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite canonical value');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  throw new Error('unsupported canonical value');
}

export function integrationPayloadDigest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export async function previewRosterExport(
  input: PreviewRosterExportInput,
  actor: AuthorizationContext,
  dependencies: PreviewRosterExportDependencies,
): Promise<PreviewRosterExportResult> {
  const parsed = previewInputSchema.safeParse(input);
  if (!parsed.success) return { outcome: 'invalid_input' };
  if (
    !can(actor, 'integration:manage', {
      organizationId: parseOrganizationId(parsed.data.organizationId),
    })
  ) {
    return { outcome: 'forbidden' };
  }

  let context;
  try {
    context = await dependencies.gateway.issuePreviewSource({
      organizationId: parsed.data.organizationId,
      actorId: actor.userId,
      connectionId: parsed.data.connectionId,
      rosterVersionId: parsed.data.rosterVersionId,
      destination: parsed.data.destination,
      approvedFields: parsed.data.approvedFields,
    });
  } catch {
    return { outcome: 'unavailable' };
  }
  if (context.outcome !== 'ok') return context;
  const roster = finalizedRosterSnapshotSchema.safeParse(context.roster);
  if (!roster.success || roster.data.rosterVersionId !== parsed.data.rosterVersionId) {
    return { outcome: 'invalid_state' };
  }
  if (
    roster.data.organizationId !== parsed.data.organizationId ||
    parsed.data.destination.organization.providerKey !== context.providerKey ||
    parsed.data.destination.mockData !== context.mockData
  ) {
    return { outcome: 'conflict' };
  }

  const request = {
    destination: parsed.data.destination,
    approvedFields: parsed.data.approvedFields,
    roster: roster.data,
  };
  const payloadDigest = integrationPayloadDigest(request);
  let preview: RosterExportPreview;
  try {
    const provider = dependencies.providers.get(context.providerKey);
    preview = rosterExportPreviewSchema.parse(
      await provider.previewRosterExport(
        {
          organizationId: parsed.data.organizationId,
          actorId: actor.userId,
          connectionId: parsed.data.connectionId,
          correlationId: parsed.data.correlationId,
          idempotencyKey: `preview:${payloadDigest}`,
        },
        request,
      ),
    );
  } catch (error) {
    return { outcome: 'connection_error', error: normalizeTeamManagementProviderError(error) };
  }
  if (preview.mockData !== context.mockData || preview.snapshotDigest !== payloadDigest) {
    return { outcome: 'conflict' };
  }
  const existing = new Set(context.existingAthleteIds);
  preview = {
    ...preview,
    items: preview.items.map((item) =>
      existing.has(item.registrationId) && item.operation === 'create'
        ? { ...item, operation: 'update' as const }
        : item,
    ),
  };

  try {
    const stored = await dependencies.gateway.savePreview({
      organizationId: parsed.data.organizationId,
      actorId: actor.userId,
      connectionId: parsed.data.connectionId,
      rosterVersionId: parsed.data.rosterVersionId,
      sourceId: context.sourceId,
      sourceDigest: context.sourceDigest,
      destination: parsed.data.destination,
      approvedFields: parsed.data.approvedFields,
      previewId: preview.previewId,
      confirmationToken: preview.confirmationToken,
      snapshotDigest: preview.snapshotDigest,
      payloadDigest,
      preview,
    });
    if (stored.outcome === 'created' || stored.outcome === 'replayed') {
      return { outcome: 'previewed', ...preview };
    }
    return stored;
  } catch {
    return { outcome: 'unavailable' };
  }
}
