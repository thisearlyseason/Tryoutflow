import { z } from 'zod';

const boundedLabel = z.string().trim().min(1).max(200);
const boundedName = z.string().trim().min(1).max(120);
const boundedToken = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/u);
const providerKeySchema = z.string().regex(/^[a-z][a-z0-9-]{1,49}$/u);
const externalIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const isoTimestampSchema = z.iso.datetime({ offset: true });

export const providerContextSchema = z.strictObject({
  organizationId: z.uuid(),
  actorId: z.uuid(),
  connectionId: z.uuid(),
  correlationId: boundedToken,
  idempotencyKey: boundedToken,
});

const callbackUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => new URL(value).protocol === 'https:', 'callback URL must use HTTPS');

export const connectionRequestSchema = z.strictObject({
  organizationId: z.uuid(),
  actorId: z.uuid(),
  correlationId: boundedToken,
  idempotencyKey: boundedToken,
  callbackUrl: callbackUrlSchema,
});

export const connectionChallengeSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('redirect'),
    challengeId: boundedToken,
    authorizationUrl: callbackUrlSchema,
    expiresAt: isoTimestampSchema,
    mockData: z.literal(false),
  }),
  z.strictObject({
    mode: z.literal('mock'),
    challengeId: boundedToken,
    expiresAt: isoTimestampSchema,
    displayLabel: boundedLabel,
    mockData: z.literal(true),
  }),
]);

const callbackParametersSchema = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,49}$/u), z.string().max(2_000))
  .refine((value) => Object.keys(value).length <= 20, 'too many callback parameters');

export const connectionCallbackSchema = z.strictObject({
  organizationId: z.uuid(),
  actorId: z.uuid(),
  correlationId: boundedToken,
  idempotencyKey: boundedToken,
  challengeId: boundedToken,
  callbackParameters: callbackParametersSchema,
});

export const connectionResultSchema = z.strictObject({
  connectionId: z.uuid(),
  providerKey: providerKeySchema,
  state: z.literal('connected'),
  displayName: boundedLabel,
  connectedAt: isoTimestampSchema,
  mockData: z.boolean(),
});

export const connectionHealthSchema = z.strictObject({
  state: z.enum(['healthy', 'degraded']),
  checkedAt: isoTimestampSchema,
  mockData: z.boolean(),
});

export const externalEntityTypeSchema = z.enum([
  'organization',
  'season',
  'division',
  'team',
  'athlete',
  'roster_version',
]);

export const externalEntityRefSchema = z.strictObject({
  providerKey: providerKeySchema,
  entityType: externalEntityTypeSchema,
  externalId: externalIdSchema,
  displayName: boundedLabel,
  mockData: z.boolean(),
});

export const externalOrganizationSchema = externalEntityRefSchema.extend({
  entityType: z.literal('organization'),
});

export const externalOrganizationListSchema = z
  .array(externalOrganizationSchema)
  .max(500)
  .refine(
    (organizations) =>
      new Set(organizations.map((item) => `${item.providerKey}:${item.externalId}`)).size ===
      organizations.length,
    'external organizations must be unique',
  );

export const externalRosterDestinationSchema = z
  .strictObject({
    organization: externalOrganizationSchema,
    season: externalEntityRefSchema.extend({ entityType: z.literal('season') }),
    division: externalEntityRefSchema.extend({ entityType: z.literal('division') }),
    team: externalEntityRefSchema.extend({ entityType: z.literal('team') }),
    displayLabel: boundedLabel,
    mockData: z.boolean(),
  })
  .superRefine((value, context) => {
    const refs = [value.organization, value.season, value.division, value.team];
    if (refs.some((ref) => ref.providerKey !== value.organization.providerKey)) {
      context.addIssue({ code: 'custom', message: 'destination provider keys must match' });
    }
    if (refs.some((ref) => ref.mockData !== value.mockData)) {
      context.addIssue({ code: 'custom', message: 'destination mock-data labels must match' });
    }
  });

export const externalRosterDestinationListSchema = z
  .array(externalRosterDestinationSchema)
  .max(2_000);

const athleteImportFields = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'birth_year',
  'position',
] as const;

export const athleteImportFieldSchema = z.enum(athleteImportFields);

const uniqueFields = <T extends string>(
  schema: z.ZodType<T>,
  maximum: number,
  canonicalOrder: readonly T[],
) => {
  const order = new Map(canonicalOrder.map((field, index) => [field, index]));
  return z
    .array(schema)
    .min(1)
    .max(maximum)
    .refine((fields) => new Set(fields).size === fields.length, 'fields must be unique')
    .transform((fields) => [...fields].sort((left, right) => order.get(left)! - order.get(right)!));
};

export const athleteImportRequestSchema = z
  .strictObject({
    sourceOrganization: externalOrganizationSchema,
    approvedFields: uniqueFields(athleteImportFieldSchema, 6, athleteImportFields),
  })
  .refine(
    (value) =>
      value.approvedFields.includes('first_name') && value.approvedFields.includes('last_name'),
    'athlete identity fields must be explicitly approved',
  );

export const importedAthleteFieldsSchema = z.strictObject({
  firstName: boundedName,
  lastName: boundedName,
  email: z.email().max(320).optional(),
  phone: z.string().trim().min(3).max(32).optional(),
  birthYear: z.number().int().min(1900).max(2200).optional(),
  position: boundedName.optional(),
});

export const athleteImportPreviewItemSchema = z.strictObject({
  externalAthlete: externalEntityRefSchema.extend({ entityType: z.literal('athlete') }),
  fields: importedAthleteFieldsSchema,
  disposition: z.enum(['new', 'duplicate', 'requires_review']),
});

export const athleteImportPreviewSchema = z
  .strictObject({
    previewId: boundedToken,
    confirmationToken: boundedToken,
    items: z.array(athleteImportPreviewItemSchema).max(5_000),
    mockData: z.boolean(),
  })
  .superRefine((value, context) => {
    if (
      new Set(value.items.map((item) => item.externalAthlete.externalId)).size !==
      value.items.length
    ) {
      context.addIssue({ code: 'custom', message: 'import preview athletes must be unique' });
    }
    if (value.items.some((item) => item.externalAthlete.mockData !== value.mockData)) {
      context.addIssue({
        code: 'custom',
        message: 'preview and external-reference mock-data labels must match',
      });
    }
  });

export const confirmedAthleteImportSchema = athleteImportRequestSchema.extend({
  previewId: boundedToken,
  confirmationToken: boundedToken,
  items: z.array(athleteImportPreviewItemSchema).max(5_000),
});

const rosterExportFields = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'position',
  'team_name',
  'tryout_number',
] as const;

export const rosterExportFieldSchema = z.enum(rosterExportFields);

export const finalizedRosterTeamSchema = z.strictObject({
  id: z.uuid(),
  name: boundedName,
});

export const finalizedRosterAthleteSchema = z.strictObject({
  registrationId: z.uuid(),
  firstName: boundedName,
  lastName: boundedName,
  email: z.email().max(320).optional(),
  phone: z.string().trim().min(3).max(32).optional(),
  position: boundedName.optional(),
  tryoutNumber: z.number().int().min(0).max(999_999).optional(),
  teamId: z.uuid(),
});

export const finalizedRosterSnapshotSchema = z
  .strictObject({
    organizationId: z.uuid(),
    tryoutId: z.uuid(),
    divisionId: z.uuid(),
    rosterVersionId: z.uuid(),
    version: z.number().int().safe().positive(),
    state: z.literal('finalized'),
    finalizedAt: isoTimestampSchema,
    teams: z.array(finalizedRosterTeamSchema).min(1).max(50),
    athletes: z.array(finalizedRosterAthleteSchema).max(5_000),
  })
  .superRefine((value, context) => {
    const teamIds = new Set(value.teams.map((team) => team.id));
    if (teamIds.size !== value.teams.length) {
      context.addIssue({ code: 'custom', message: 'team IDs must be unique' });
    }
    const registrationIds = new Set(value.athletes.map((athlete) => athlete.registrationId));
    if (registrationIds.size !== value.athletes.length) {
      context.addIssue({ code: 'custom', message: 'registration IDs must be unique' });
    }
    value.athletes.forEach((athlete, index) => {
      if (!teamIds.has(athlete.teamId)) {
        context.addIssue({
          code: 'custom',
          message: 'athlete team must be part of the finalized snapshot',
          path: ['athletes', index, 'teamId'],
        });
      }
    });
  });

export const finalizedRosterExportRequestSchema = z.strictObject({
  destination: externalRosterDestinationSchema,
  // Adapters may project only these fields. When both name fields are not approved,
  // item labels use the opaque registration reference (or an approved tryout number),
  // never a partial name or another field from the full authoritative snapshot.
  approvedFields: uniqueFields(rosterExportFieldSchema, 7, rosterExportFields),
  roster: finalizedRosterSnapshotSchema,
});

export const rosterExportProjectedFieldsSchema = z.strictObject({
  firstName: boundedName.optional(),
  lastName: boundedName.optional(),
  email: z.email().max(320).optional(),
  phone: z.string().trim().min(3).max(32).optional(),
  position: boundedName.optional(),
  teamName: boundedName.optional(),
  tryoutNumber: z.number().int().min(0).max(999_999).optional(),
});

export const rosterExportPreviewItemSchema = z.strictObject({
  itemKey: z.string().regex(/^athlete:[0-9a-f-]{36}$/u),
  registrationId: z.uuid(),
  operation: z.enum(['create', 'update', 'skip', 'requires_review']),
  displayLabel: boundedLabel,
  fields: rosterExportProjectedFieldsSchema,
});

export const rosterExportPreviewSchema = z
  .strictObject({
    previewId: boundedToken,
    confirmationToken: boundedToken,
    snapshotDigest: sha256Schema,
    totalItems: z.number().int().min(0).max(5_000),
    items: z.array(rosterExportPreviewItemSchema).max(5_000),
    mockData: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.totalItems !== value.items.length) {
      context.addIssue({ code: 'custom', message: 'preview total must match items' });
    }
    if (new Set(value.items.map((item) => item.itemKey)).size !== value.items.length) {
      context.addIssue({ code: 'custom', message: 'preview item keys must be unique' });
    }
    value.items.forEach((item, index) => {
      if (item.itemKey !== `athlete:${item.registrationId}`) {
        context.addIssue({
          code: 'custom',
          message: 'preview item key must identify its registration',
          path: ['items', index, 'itemKey'],
        });
      }
    });
  });

export const confirmedRosterExportSchema = finalizedRosterExportRequestSchema.extend({
  previewId: boundedToken,
  confirmationToken: boundedToken,
});

export const providerErrorCodeSchema = z.enum([
  'authentication_required',
  'connection_invalid',
  'permission_denied',
  'invalid_request',
  'not_found',
  'conflict',
  'rate_limited',
  'provider_temporary',
  'provider_rejected',
  'provider_configuration',
  'delivery_uncertain',
  'timeout',
]);

export const teamManagementProviderErrorSchema = z
  .strictObject({
    code: providerErrorCodeSchema,
    retryable: z.boolean(),
    retryAfterSeconds: z.number().int().min(1).max(86_400).optional(),
  })
  .superRefine((value, context) => {
    const retryable = ['rate_limited', 'provider_temporary', 'timeout'].includes(value.code);
    if (value.retryable !== retryable) {
      context.addIssue({ code: 'custom', message: 'retryability must match the normalized code' });
    }
    if (value.retryAfterSeconds !== undefined && value.code !== 'rate_limited') {
      context.addIssue({ code: 'custom', message: 'only rate limits may specify retry-after' });
    }
  });

export const syncItemStateSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
  'skipped',
  'requires_review',
]);

const syncJobItemShape = {
  itemKey: z.string().regex(/^[a-z][a-z0-9_-]{1,39}:[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u),
  entityType: z.enum(['athlete', 'team', 'roster_version']),
  attempts: z.number().int().min(0).max(100),
  externalRef: externalEntityRefSchema.nullable(),
  error: teamManagementProviderErrorSchema.nullable(),
};

function validateSyncItem(
  value: z.infer<typeof providerSyncJobItemStatusSchema>,
  context: z.RefinementCtx,
) {
  if (value.state === 'completed' && value.externalRef === null) {
    context.addIssue({
      code: 'custom',
      message: 'completed item requires an external reference',
    });
  }
  if (value.state === 'pending' && value.attempts !== 0) {
    context.addIssue({ code: 'custom', message: 'pending item must not have an attempt' });
  }
  if (value.state === 'processing' && value.attempts === 0) {
    context.addIssue({ code: 'custom', message: 'processing item requires an attempt' });
  }
  if (['pending', 'processing'].includes(value.state) && value.externalRef !== null) {
    context.addIssue({
      code: 'custom',
      message: 'in-flight item cannot contain a completed external reference',
    });
  }
  if (['failed', 'requires_review'].includes(value.state) && value.error === null) {
    context.addIssue({ code: 'custom', message: 'failed or review item requires an error' });
  }
  if (!['failed', 'requires_review'].includes(value.state) && value.error !== null) {
    context.addIssue({
      code: 'custom',
      message: 'only failed or review items may contain an error',
    });
  }
  if (value.externalRef !== null && value.externalRef.entityType !== value.entityType) {
    context.addIssue({ code: 'custom', message: 'external reference type must match the item' });
  }
}

export const providerSyncJobItemStatusSchema = z
  .strictObject({ ...syncJobItemShape, state: syncItemStateSchema })
  .superRefine(validateSyncItem);

export const syncJobItemResultSchema = z
  .strictObject({
    ...syncJobItemShape,
    state: z.enum(['completed', 'failed', 'skipped', 'requires_review']),
  })
  .superRefine(validateSyncItem);

function derivedJobState(items: readonly { state: z.infer<typeof syncItemStateSchema> }[]) {
  const completed = items.filter((item) => ['completed', 'skipped'].includes(item.state)).length;
  const failed = items.filter((item) => ['failed', 'requires_review'].includes(item.state)).length;
  if (failed === 0 && completed === items.length) return 'completed' as const;
  if (completed > 0 && failed > 0 && completed + failed === items.length)
    return 'partially_completed' as const;
  if (completed === 0 && failed === items.length) return 'failed' as const;
  return null;
}

export const syncJobResultSchema = z
  .strictObject({
    externalJobId: externalIdSchema,
    state: z.enum(['completed', 'partially_completed', 'failed']),
    items: z.array(syncJobItemResultSchema).max(5_100),
    mockData: z.boolean(),
  })
  .superRefine((value, context) => {
    if (new Set(value.items.map((item) => item.itemKey)).size !== value.items.length) {
      context.addIssue({ code: 'custom', message: 'sync item keys must be unique' });
    }
    if (derivedJobState(value.items) !== value.state) {
      context.addIssue({ code: 'custom', message: 'job state must be derived from item states' });
    }
    value.items.forEach((item, index) => {
      if (item.externalRef !== null && item.externalRef.mockData !== value.mockData) {
        context.addIssue({
          code: 'custom',
          message: 'job and external-reference mock-data labels must match',
          path: ['items', index, 'externalRef', 'mockData'],
        });
      }
    });
  });

function derivedProviderStatus(items: readonly z.infer<typeof providerSyncJobItemStatusSchema>[]) {
  if (items.some((item) => item.state === 'processing')) return 'processing' as const;
  if (items.some((item) => item.state === 'pending')) return 'pending' as const;
  return derivedJobState(items);
}

export const providerSyncStatusSchema = z
  .strictObject({
    externalJobId: externalIdSchema,
    state: z.enum(['pending', 'processing', 'completed', 'partially_completed', 'failed']),
    items: z.array(providerSyncJobItemStatusSchema).max(5_100),
    mockData: z.boolean(),
  })
  .superRefine((value, context) => {
    if (new Set(value.items.map((item) => item.itemKey)).size !== value.items.length) {
      context.addIssue({ code: 'custom', message: 'sync item keys must be unique' });
    }
    if (derivedProviderStatus(value.items) !== value.state) {
      context.addIssue({ code: 'custom', message: 'status must be derived from item states' });
    }
    value.items.forEach((item, index) => {
      if (item.externalRef !== null && item.externalRef.mockData !== value.mockData) {
        context.addIssue({
          code: 'custom',
          message: 'job and external-reference mock-data labels must match',
          path: ['items', index, 'externalRef', 'mockData'],
        });
      }
    });
  });

export type ProviderContext = z.infer<typeof providerContextSchema>;
export type ConnectionRequest = z.infer<typeof connectionRequestSchema>;
export type ConnectionChallenge = z.infer<typeof connectionChallengeSchema>;
export type ConnectionCallback = z.infer<typeof connectionCallbackSchema>;
export type ConnectionResult = z.infer<typeof connectionResultSchema>;
export type ConnectionHealth = z.infer<typeof connectionHealthSchema>;
export type ExternalEntityRef = z.infer<typeof externalEntityRefSchema>;
export type ExternalOrganization = z.infer<typeof externalOrganizationSchema>;
export type ExternalRosterDestination = z.infer<typeof externalRosterDestinationSchema>;
export type AthleteImportRequest = z.infer<typeof athleteImportRequestSchema>;
export type AthleteImportPreview = z.infer<typeof athleteImportPreviewSchema>;
export type ConfirmedAthleteImport = z.infer<typeof confirmedAthleteImportSchema>;
export type FinalizedRosterExportRequest = z.infer<typeof finalizedRosterExportRequestSchema>;
export type RosterExportPreview = z.infer<typeof rosterExportPreviewSchema>;
export type RosterExportProjectedFields = z.infer<typeof rosterExportProjectedFieldsSchema>;
export type ConfirmedRosterExport = z.infer<typeof confirmedRosterExportSchema>;
export type SyncJobResult = z.infer<typeof syncJobResultSchema>;
export type ProviderSyncStatus = z.infer<typeof providerSyncStatusSchema>;
export type TeamManagementProviderError = z.infer<typeof teamManagementProviderErrorSchema>;
