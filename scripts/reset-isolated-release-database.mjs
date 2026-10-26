import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { request } from 'node:http';
import { setTimeout } from 'node:timers/promises';
import {
  assertIsolatedResetReplacement,
  verifyIsolatedReleaseTargets,
} from './lib/isolated-release-database.mjs';
import { resolveAndValidateLocalDatabase } from './lib/local-supabase-database.mjs';

const args = process.argv.slice(2);
if (!['--local', '--local --no-seed'].includes(args.join(' '))) {
  throw new Error('Only the canonical local release reset is supported.');
}
const proofPath = 'supabase/.temp/isolated-release-proof.json';
const originalProof = readFileSync(proofPath, 'utf8');
const proof = JSON.parse(originalProof);
const configHash = () =>
  createHash('sha256').update(readFileSync('supabase/config.toml')).digest('hex');
const inspect = (id) =>
  JSON.parse(execFileSync('docker', ['inspect', id], { encoding: 'utf8' }))[0];
const databaseUrl = process.env.SUPABASE_DB_URL;
const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
verifyIsolatedReleaseTargets(databaseUrl, apiUrl);
const before = inspect(proof.databaseContainerId);
const endpoint = execFileSync(
  'docker',
  ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
  { encoding: 'utf8' },
).trim();
if (!endpoint.startsWith('unix://')) throw new Error('Require the local Docker Unix socket.');
const api = (method, path, body) =>
  new Promise((resolve, reject) => {
    const call = request(
      {
        socketPath: endpoint.slice(7),
        method,
        path,
        headers: { 'Content-Type': 'application/json' },
        timeout: 60_000,
      },
      (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (part) => {
          data += part;
        });
        response.on('end', () => {
          if (![200, 201, 204, 304].includes(response.statusCode))
            return reject(
              new Error(`Owned Docker reset operation failed: ${method} ${response.statusCode}`),
            );
          resolve(data ? JSON.parse(data) : undefined);
        });
      },
    );
    call.on('error', reject);
    call.on('timeout', () => call.destroy(new Error('Owned Docker operation timed out.')));
    call.end(body === undefined ? undefined : JSON.stringify(body));
  });

// Supabase's local reset intentionally replaces the database/container. Only
// this synchronous, prevalidated reset may advance the recorded identity.
execFileSync('corepack', ['npm@11.12.1', 'exec', '--', 'supabase', 'db', 'reset', ...args], {
  stdio: 'inherit',
});
const after = inspect(`supabase_db_${proof.projectId}`);
const networks = Object.values(after.NetworkSettings.Networks);
assertIsolatedResetReplacement({
  proof,
  before,
  after,
  databasePort: new URL(databaseUrl).port,
  currentConfigHash: configHash(),
  proofUnchanged: readFileSync(proofPath, 'utf8') === originalProof,
});

// Docker Desktop ignores the bridge default binding during CLI recreation.
// Recreate only this verified replacement using its same image, mounts/config,
// aliases and network, with the original loopback port explicitly restored.
const host = after.HostConfig;
host.PortBindings['5432/tcp'] = [{ HostIp: '127.0.0.1', HostPort: new URL(databaseUrl).port }];
const networkName = Object.keys(after.NetworkSettings.Networks)[0];
await api('POST', `/containers/${after.Id}/stop?t=10`);
await api('DELETE', `/containers/${after.Id}`);
const created = await api(
  'POST',
  `/containers/create?name=${encodeURIComponent(after.Name.slice(1))}`,
  {
    ...after.Config,
    HostConfig: host,
    NetworkingConfig: { EndpointsConfig: { [networkName]: { Aliases: networks[0].Aliases } } },
  },
);
await api('POST', `/containers/${created.Id}/start`);
let healthy = false;
for (let attempt = 0; attempt < 45; attempt++) {
  const current = inspect(created.Id);
  if (current.State.Running && current.State.Health?.Status === 'healthy') {
    healthy = true;
    break;
  }
  await setTimeout(2_000);
}
if (!healthy) throw new Error('Owned replacement database did not become healthy.');
const selected = resolveAndValidateLocalDatabase(databaseUrl);
if (selected.id !== created.Id)
  throw new Error('Replacement endpoint does not identify the owned container.');
if (configHash() !== proof.configSHA256 || readFileSync(proofPath, 'utf8') !== originalProof)
  throw new Error('Reset context changed.');
const updated = { ...proof, databaseContainerId: created.Id, databaseIdentity: selected.identity };
writeFileSync(`${proofPath}.tmp`, `${JSON.stringify(updated, null, 2)}\n`);
renameSync(`${proofPath}.tmp`, proofPath);
verifyIsolatedReleaseTargets(databaseUrl, apiUrl);
console.log('Owned local reset completed; replacement identity and loopback binding verified.');
