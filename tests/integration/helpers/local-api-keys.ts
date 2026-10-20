import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type LocalApiKeys = { apiUrl: string; service: string; publishable: string };
type IsolatedGuard = {
  verifyIsolatedReleaseTargets(
    databaseUrl: string,
    apiUrl: string,
    environment: NodeJS.ProcessEnv,
  ): unknown;
};

function localStatus(): Record<string, unknown> {
  try {
    return JSON.parse(
      execFileSync('./node_modules/.bin/supabase', ['status', '-o', 'json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ) as Record<string, unknown>;
  } catch {
    // Status contains local credentials; never attach its output to a failure.
    throw new Error('Local Supabase status unavailable.');
  }
}

/** Keep integration credentials bound to the same proved local database and API. */
export async function localIntegrationApiKeys(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<LocalApiKeys> {
  if (environment.TRYOUTFLOW_ISOLATED_RELEASE_PROJECT) {
    const databaseUrl = environment.SUPABASE_DB_URL;
    if (!databaseUrl) throw new Error('Isolated integration database URL is required.');
    const proof = JSON.parse(
      readFileSync(resolve('supabase/.temp/isolated-release-proof.json'), 'utf8'),
    ) as { apiOrigin?: unknown };
    if (typeof proof.apiOrigin !== 'string')
      throw new Error('Isolated integration API proof is unavailable.');
    const guardPath = new URL(
      '../../../scripts/lib/isolated-release-database.mjs',
      import.meta.url,
    );
    const { verifyIsolatedReleaseTargets } = (await import(guardPath.href)) as IsolatedGuard;
    // Prove the exact owned Kong and database before reading status credentials.
    verifyIsolatedReleaseTargets(databaseUrl, proof.apiOrigin, environment);
    const status = localStatus();
    if (typeof status.DB_URL !== 'string' || typeof status.API_URL !== 'string')
      throw new Error('Isolated local Supabase target metadata unavailable.');
    verifyIsolatedReleaseTargets(status.DB_URL, status.API_URL, environment);
    const service = status.SECRET_KEY;
    const publishable = status.PUBLISHABLE_KEY;
    if (
      typeof service !== 'string' ||
      !/^sb_secret_[A-Za-z0-9_-]+$/u.test(service) ||
      typeof publishable !== 'string' ||
      !/^sb_publishable_[A-Za-z0-9_-]+$/u.test(publishable)
    )
      throw new Error('Isolated local Supabase API keys unavailable.');
    return { apiUrl: status.API_URL, service, publishable };
  }

  // Preserve the existing canonical local fixture behavior outside isolated runs.
  const config = execFileSync(
    'docker',
    ['exec', 'supabase_kong_tryoutflow', 'cat', '/home/kong/kong.yml'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const service = config.match(/sb_secret_[A-Za-z0-9_-]+/u)?.[0];
  const publishable = config.match(/sb_publishable_[A-Za-z0-9_-]+/u)?.[0];
  const apiUrl = localStatus().API_URL;
  if (!service || !publishable || typeof apiUrl !== 'string')
    throw new Error('Local Supabase API keys unavailable.');
  return { apiUrl, service, publishable };
}
