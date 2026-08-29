import { execFileSync } from 'node:child_process';

/**
 * @typedef {{HostIp: string, HostPort: string}} DockerPortBinding
 * @typedef {{
 *   id: string,
 *   name: string,
 *   labels: Record<string, string>,
 *   ports: Record<string, DockerPortBinding[] | null>
 * }} DockerDatabaseContainer
 */

const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);
const wildcardBindings = new Set(['0.0.0.0', '::']);

function parseDatabaseUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('SUPABASE_DB_URL must use PostgreSQL');
  }
  if (!parsed.port) throw new Error('SUPABASE_DB_URL must include an explicit port');
  const database = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  if (!database || database.includes('/')) {
    throw new Error('SUPABASE_DB_URL must include one explicit database');
  }
  return {
    hostname: parsed.hostname.replace(/^\[|\]$/gu, ''),
    port: parsed.port,
    database,
    username: decodeURIComponent(parsed.username || 'postgres'),
  };
}

function bindingMatches(hostname, port, binding) {
  if (binding.HostPort !== port) return false;
  if (loopbackHosts.has(hostname)) {
    return loopbackHosts.has(binding.HostIp) || wildcardBindings.has(binding.HostIp);
  }
  return binding.HostIp === hostname;
}

/**
 * @param {string} databaseUrl
 * @param {DockerDatabaseContainer[]} candidates
 */
export function selectDatabaseContainer(databaseUrl, candidates) {
  const target = parseDatabaseUrl(databaseUrl);
  const matches = candidates.filter(
    (candidate) =>
      candidate.name.startsWith('supabase_db_') &&
      Boolean(candidate.labels['com.supabase.cli.project']) &&
      Boolean(candidate.labels['com.supabase.cli.workdir']) &&
      (candidate.ports['5432/tcp'] ?? []).some((binding) =>
        bindingMatches(target.hostname, target.port, binding),
      ),
  );
  if (matches.length === 0) {
    throw new Error(
      `no Supabase database container matches ${target.hostname}:${target.port}/${target.database}`,
    );
  }
  if (matches.length !== 1) {
    throw new Error(
      `multiple Supabase database containers match ${target.hostname}:${target.port}/${target.database}`,
    );
  }
  return { ...matches[0], database: target.database, username: target.username };
}

/** @returns {DockerDatabaseContainer[]} */
export function inspectRunningSupabaseDatabaseContainers() {
  const ids = execFileSync(
    'docker',
    ['ps', '--filter', 'name=supabase_db_', '--format', '{{.ID}}'],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  if (ids.length === 0) return [];
  const inspected = JSON.parse(execFileSync('docker', ['inspect', ...ids], { encoding: 'utf8' }));
  return inspected.map((container) => ({
    id: container.Id,
    name: String(container.Name).replace(/^\//u, ''),
    labels: container.Config?.Labels ?? {},
    ports: container.NetworkSettings?.Ports ?? {},
  }));
}

function databaseIdentity(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

export function assertDatabaseIdentity(endpointIdentity, containerIdentity, selected) {
  if (!endpointIdentity || endpointIdentity !== containerIdentity) {
    throw new Error(
      `configured database endpoint does not identify container ${selected.name} database ${selected.database}`,
    );
  }
}

export function resolveAndValidateDatabaseContainer(databaseUrl) {
  const selected = selectDatabaseContainer(databaseUrl, inspectRunningSupabaseDatabaseContainers());
  const identitySql =
    "select current_database()||'|'||(pg_control_system()).system_identifier::text";
  const endpointIdentity = databaseIdentity('psql', ['-X', '-At', databaseUrl, '-c', identitySql]);
  const containerIdentity = databaseIdentity('docker', [
    'exec',
    selected.name,
    'psql',
    '-X',
    '-U',
    selected.username,
    '-d',
    selected.database,
    '-At',
    '-c',
    identitySql,
  ]);
  assertDatabaseIdentity(endpointIdentity, containerIdentity, selected);
  return selected;
}

export function dumpLocalSupabaseSchemas(databaseUrl, schemas) {
  const selected = resolveAndValidateDatabaseContainer(databaseUrl);
  return execFileSync(
    'docker',
    [
      'exec',
      selected.name,
      'pg_dump',
      '-U',
      selected.username,
      '-d',
      selected.database,
      '--schema-only',
      '--no-owner',
      ...schemas.map((schema) => `--schema=${schema}`),
    ],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  )
    .split('\n')
    .filter((line) => !line.startsWith('ALTER DEFAULT PRIVILEGES'))
    .join('\n');
}
