export interface IntegrationManifestBody {
  version: 1;
  runId: string;
  databaseIdentity: string;
  role: string;
  ownershipSchema: string;
  databasePrefixes: string[];
}

export interface SupervisorStateStore {
  directory: string;
  manifestPath(runId: string): string;
  rateKeyPath(runId: string): string;
  manifestBody(runId: string): IntegrationManifestBody;
  writeManifest(body: IntegrationManifestBody): void;
  readRecoverableManifests(excludedRunId?: string): Array<{
    body: IntegrationManifestBody;
    path: string;
  }>;
  readRateKeys(runId: string): string[];
  removeRunState(runId: string): void;
}

export function createSupervisorStateStore(options: {
  identity: string;
  baseDirectory?: string;
}): SupervisorStateStore;
