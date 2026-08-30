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
  commandPath(runId: string): string;
  commandGoPath(runId: string): string;
  manifestBody(runId: string): IntegrationManifestBody;
  writeManifest(body: IntegrationManifestBody): void;
  advanceCleanup(
    runId: string,
    cleanupStage:
      | 'active'
      | 'sessions-terminated'
      | 'fixtures-removed'
      | 'roots-removed'
      | 'rate-keys-removed'
      | 'registry-removed',
  ): void;
  readRecoverableManifests(excludedRunId?: string): Array<{
    body: IntegrationManifestBody;
    cleanupStage: string;
    path: string;
  }>;
  writeCommand(runId: string, command: { nonce: string }): void;
  bindCommand(
    runId: string,
    command: { pid: number; pgid: number; startedAt: string; nonce: string },
  ): void;
  readCommand(runId: string): {
    pid?: number;
    pgid?: number;
    startedAt?: string;
    nonce: string;
  } | null;
  permitCommand(runId: string): void;
  removeCommand(runId: string): void;
  removeRunState(runId: string): void;
}

export function createSupervisorStateStore(options: {
  identity: string;
  baseDirectory?: string;
}): SupervisorStateStore;
