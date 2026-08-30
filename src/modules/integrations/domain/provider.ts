import {
  providerErrorCodeSchema,
  teamManagementProviderErrorSchema,
  type AthleteImportPreview,
  type AthleteImportRequest,
  type ConfirmedAthleteImport,
  type ConfirmedRosterExport,
  type ConnectionCallback,
  type ConnectionChallenge,
  type ConnectionHealth,
  type ConnectionRequest,
  type ConnectionResult,
  type ExternalEntityRef,
  type ExternalOrganization,
  type ExternalRosterDestination,
  type FinalizedRosterExportRequest,
  type ProviderContext,
  type ProviderSyncStatus,
  type RosterExportPreview,
  type SyncJobResult,
  type TeamManagementProviderError,
} from './contracts';

export type {
  AthleteImportPreview,
  AthleteImportRequest,
  ConfirmedAthleteImport,
  ConfirmedRosterExport,
  ConnectionCallback,
  ConnectionChallenge,
  ConnectionHealth,
  ConnectionRequest,
  ConnectionResult,
  ExternalEntityRef,
  ExternalOrganization,
  ExternalRosterDestination,
  FinalizedRosterExportRequest,
  ProviderContext,
  ProviderSyncStatus,
  RosterExportPreview,
  SyncJobResult,
  TeamManagementProviderError,
} from './contracts';

export interface TeamManagementProvider {
  readonly providerKey: string;
  beginConnection(input: ConnectionRequest): Promise<ConnectionChallenge>;
  completeConnection(input: ConnectionCallback): Promise<ConnectionResult>;
  verifyConnection(context: ProviderContext): Promise<ConnectionHealth>;
  disconnect(context: ProviderContext): Promise<void>;
  listOrganizations(context: ProviderContext): Promise<ExternalOrganization[]>;
  listDestinations(
    context: ProviderContext,
    organization: ExternalEntityRef,
  ): Promise<ExternalRosterDestination[]>;
  previewAthleteImport(
    context: ProviderContext,
    request: AthleteImportRequest,
  ): Promise<AthleteImportPreview>;
  importAthletes(context: ProviderContext, request: ConfirmedAthleteImport): Promise<SyncJobResult>;
  previewRosterExport(
    context: ProviderContext,
    request: FinalizedRosterExportRequest,
  ): Promise<RosterExportPreview>;
  exportFinalizedRoster(
    context: ProviderContext,
    request: ConfirmedRosterExport,
  ): Promise<SyncJobResult>;
  getSyncStatus(context: ProviderContext, externalJobId: string): Promise<ProviderSyncStatus>;
}

const retryableCodes: ReadonlySet<TeamManagementProviderError['code']> = new Set([
  'rate_limited',
  'provider_temporary',
  'timeout',
]);

export function isTeamManagementProviderError(
  error: unknown,
): error is TeamManagementProviderError {
  return teamManagementProviderErrorSchema.safeParse(error).success;
}

export function normalizeTeamManagementProviderError(error: unknown): TeamManagementProviderError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    providerErrorCodeSchema.safeParse((error as { code: unknown }).code).success
  ) {
    const code = providerErrorCodeSchema.parse((error as { code: unknown }).code);
    const retryAfter =
      'retryAfterSeconds' in error
        ? zSafeRetryAfter((error as { retryAfterSeconds: unknown }).retryAfterSeconds)
        : undefined;
    return retryAfter === undefined
      ? { code, retryable: retryableCodes.has(code) }
      : { code, retryable: retryableCodes.has(code), retryAfterSeconds: retryAfter };
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'TimeoutError'
  ) {
    return { code: 'timeout', retryable: true };
  }
  return { code: 'provider_configuration', retryable: false };
}

function zSafeRetryAfter(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 86_400
    ? value
    : undefined;
}
