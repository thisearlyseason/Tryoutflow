import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  resolveAndValidateLocalDatabase,
  inspectRunningSupabaseDatabaseContainers,
  selectDatabaseContainer,
} from './local-supabase-database.mjs';

export function assertIsolatedReleaseDatabaseUrl(value) {
  const parsed = new URL(value);
  if (
    parsed.protocol !== 'postgresql:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) ||
    !parsed.port ||
    parsed.pathname !== '/postgres' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Isolated release fixtures require an explicit loopback PostgreSQL database.');
  }
  return parsed;
}

export function assertIsolatedReleaseDatabaseOwnership({
  expectedProject,
  proof,
  selected,
  workdir,
  configHash,
  databasePort,
}) {
  if (
    typeof expectedProject !== 'string' ||
    !/^tryoutflow-lint-verify-[0-9a-f]{12}$/.test(expectedProject) ||
    proof?.schemaVersion !== 1 ||
    proof?.freshCreatedForThisRun !== true ||
    proof?.projectId !== expectedProject ||
    proof?.workdir !== workdir ||
    proof?.databaseContainerId !== selected.id ||
    proof?.configSHA256 !== configHash ||
    !/^[0-9a-f]{64}$/.test(configHash ?? '') ||
    selected.labels?.['com.supabase.cli.project'] !== expectedProject ||
    selected.labels?.['com.supabase.cli.workdir'] !== workdir ||
    selected.database !== 'postgres' ||
    !Array.isArray(selected.networkIds) ||
    selected.networkIds.length !== 1 ||
    selected.networkIds[0] !== proof.networkId ||
    !(selected.ports?.['5432/tcp']?.length > 0) ||
    selected.ports['5432/tcp'].some(
      (binding) =>
        !['127.0.0.1', '::1'].includes(binding.HostIp) || binding.HostPort !== databasePort,
    )
  ) {
    throw new Error('Fresh isolated release database ownership/identity proof does not match.');
  }
}

export function assertIsolatedReleaseDatabaseProof(value) {
  assertIsolatedReleaseDatabaseOwnership(value);
  if (!value.proof.databaseIdentity || value.proof.databaseIdentity !== value.selected.identity) {
    throw new Error('Fresh isolated release database system identity changed.');
  }
}

function inspectContainer(id) {
  const rows = JSON.parse(execFileSync('docker', ['inspect', id], { encoding: 'utf8' }));
  if (rows.length !== 1) throw new Error('Isolated release container identity is ambiguous.');
  const row = rows[0];
  return {
    id: row.Id,
    labels: row.Config?.Labels ?? {},
    ports: row.NetworkSettings?.Ports ?? {},
    networkIds: Object.values(row.NetworkSettings?.Networks ?? {}).map(
      (network) => network.NetworkID,
    ),
  };
}

function context(environment) {
  const expected = environment.TRYOUTFLOW_ISOLATED_RELEASE_PROJECT;
  if (typeof expected !== 'string' || !/^tryoutflow-lint-verify-[0-9a-f]{12}$/.test(expected))
    throw new Error('Invalid isolated release project scope.');
  const config = readFileSync(resolve('supabase/config.toml'), 'utf8');
  const configuredProjects = [...config.matchAll(/^project_id\s*=\s*"([^"]+)"\s*$/gm)];
  if (configuredProjects.length !== 1 || configuredProjects[0][1] !== expected)
    throw new Error(
      'Supabase CLI configuration does not select the owned isolated release project.',
    );
  const workdir = realpathSync(process.cwd());
  return {
    expectedProject: environment.TRYOUTFLOW_ISOLATED_RELEASE_PROJECT,
    workdir,
    proof: JSON.parse(readFileSync(resolve('supabase/.temp/isolated-release-proof.json'), 'utf8')),
    configHash: createHash('sha256')
      .update(readFileSync(resolve('supabase/config.toml')))
      .digest('hex'),
  };
}

export function verifyIsolatedReleaseDatabase(databaseUrl, environment = process.env) {
  const parsed = assertIsolatedReleaseDatabaseUrl(databaseUrl);
  const expectedProject = environment.TRYOUTFLOW_ISOLATED_RELEASE_PROJECT;
  if (!expectedProject)
    throw new Error('No isolated release database was authorized for this run.');
  const current = context(environment);
  const candidate = selectDatabaseContainer(
    databaseUrl,
    inspectRunningSupabaseDatabaseContainers(),
  );
  const metadata = inspectContainer(candidate.id);
  // Reject wrong ownership/bindings/config before any PostgreSQL connection.
  assertIsolatedReleaseDatabaseOwnership({
    ...current,
    selected: { ...candidate, ...metadata },
    databasePort: parsed.port,
  });
  // This existing guard compares the endpoint's system identifier/database OID
  // with a Docker exec query to the uniquely matching local Supabase container.
  const selected = resolveAndValidateLocalDatabase(databaseUrl);
  assertIsolatedReleaseDatabaseProof({
    ...current,
    selected: { ...selected, ...metadata },
    databasePort: parsed.port,
  });
  return selected;
}

export function assertIsolatedReleaseApiProof({
  apiUrl,
  expectedProject,
  proof,
  selected,
  workdir,
}) {
  const api = new URL(apiUrl);
  if (
    api.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname) ||
    !api.port ||
    api.pathname !== '/' ||
    api.search ||
    api.hash ||
    api.username ||
    api.password ||
    api.origin !== proof.apiOrigin ||
    selected.id !== proof.apiContainerId ||
    selected.labels?.['com.supabase.cli.project'] !== expectedProject ||
    selected.labels?.['com.supabase.cli.workdir'] !== workdir ||
    selected.networkIds?.length !== 1 ||
    selected.networkIds[0] !== proof.networkId ||
    !(selected.ports?.['8000/tcp']?.length > 0) ||
    selected.ports['8000/tcp'].some(
      (binding) => !['127.0.0.1', '::1'].includes(binding.HostIp) || binding.HostPort !== api.port,
    )
  ) {
    throw new Error('Fresh isolated release API target is not the owned loopback gateway.');
  }
}

export function verifyIsolatedReleaseTargets(databaseUrl, apiUrl, environment = process.env) {
  assertIsolatedReleaseDatabaseUrl(databaseUrl);
  const current = context(environment);
  // API ownership is metadata-only; no HTTP calls occur before database proof.
  assertIsolatedReleaseApiProof({
    ...current,
    apiUrl,
    selected: inspectContainer(current.proof.apiContainerId),
  });
  return verifyIsolatedReleaseDatabase(databaseUrl, environment);
}

/** A new identity is accepted only immediately after our verified local reset. */
export function assertIsolatedResetReplacement({
  proof,
  before,
  after,
  databasePort,
  currentConfigHash,
  proofUnchanged,
}) {
  const mounts = (row) =>
    row.Mounts.map((mount) => [mount.Type, mount.Name ?? mount.Source, mount.Destination]).sort();
  const networks = Object.values(after.NetworkSettings.Networks);
  if (
    currentConfigHash !== proof.configSHA256 ||
    !proofUnchanged ||
    after.Config.Labels['com.supabase.cli.project'] !== proof.projectId ||
    after.Config.Labels['com.supabase.cli.workdir'] !== proof.workdir ||
    after.Image !== before.Image ||
    JSON.stringify(mounts(after)) !== JSON.stringify(mounts(before)) ||
    networks.length !== 1 ||
    networks[0].NetworkID !== proof.networkId ||
    !after.HostConfig.PortBindings['5432/tcp']?.length ||
    after.HostConfig.PortBindings['5432/tcp'].some(
      (binding) => binding.HostPort !== databasePort,
    ) ||
    Object.keys(after.HostConfig.PortBindings).some((port) => port !== '5432/tcp')
  )
    throw new Error('Replacement database is not the exact owned reset target.');
}
