export interface DockerPortBinding {
  HostIp: string;
  HostPort: string;
}

export interface DockerDatabaseContainer {
  id: string;
  name: string;
  labels: Record<string, string>;
  ports: Record<string, DockerPortBinding[] | null>;
}

export interface ResolvedDatabaseContainer extends DockerDatabaseContainer {
  database: string;
  username: string;
}

export function selectDatabaseContainer(
  databaseUrl: string,
  candidates: DockerDatabaseContainer[],
): ResolvedDatabaseContainer;
export function inspectRunningSupabaseDatabaseContainers(): DockerDatabaseContainer[];
export function assertDatabaseIdentity(
  endpointIdentity: string,
  containerIdentity: string,
  selected: Pick<ResolvedDatabaseContainer, 'name' | 'database'>,
): void;
export function resolveAndValidateDatabaseContainer(databaseUrl: string): ResolvedDatabaseContainer;
export function dumpLocalSupabaseSchemas(databaseUrl: string, schemas: string[]): string;
