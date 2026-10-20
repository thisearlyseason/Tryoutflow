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
  password: string;
  identity?: string;
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
export function canonicalDatabaseIdentity(identity: string): string;
export function resolveAndValidateLocalDatabase(
  databaseUrl: string,
): ResolvedDatabaseContainer & { identity: string };
export function resolveAndValidateDatabaseContainer(databaseUrl: string): ResolvedDatabaseContainer;
export function dumpLocalSupabaseSchemas(databaseUrl: string, schemas: string[]): string;
