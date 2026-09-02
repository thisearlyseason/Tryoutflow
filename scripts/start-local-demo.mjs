import { execFileSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertLocalSupabaseUrl, ensureLocalDemoUser } from './ensure-local-demo-user.mjs';

const LOCAL_DEMO_ORIGIN = 'http://localhost:3112';
const LOCAL_DEMO_RATE_LIMIT_SECRET =
  'tryoutflow-local-demo-rate-limit-secret-v1-000000000000000000000000';

function localStatus() {
  const raw = JSON.parse(
    execFileSync(resolve('node_modules/.bin/supabase'), ['status', '-o', 'json'], {
      encoding: 'utf8',
    }),
  );
  return {
    apiUrl: String(raw.API_URL ?? ''),
    publishableKey: String(raw.PUBLISHABLE_KEY ?? raw.ANON_KEY ?? ''),
    serviceRoleKey: String(raw.SECRET_KEY ?? raw.SERVICE_ROLE_KEY ?? ''),
  };
}

export function createLocalDemoEnvironment(status, environment = process.env) {
  const api = assertLocalSupabaseUrl(status.apiUrl);
  if (!['127.0.0.1', 'localhost'].includes(api.hostname))
    throw new Error('Local demo requires Supabase on 127.0.0.1 or localhost.');
  if (api.port !== '54321') throw new Error('Local demo requires Supabase API port 54321.');
  if (!status.publishableKey || !status.serviceRoleKey)
    throw new Error('Local Supabase status is missing API keys.');
  if (environment.NEXT_PUBLIC_APP_URL && environment.NEXT_PUBLIC_APP_URL !== LOCAL_DEMO_ORIGIN)
    throw new Error('Local demo must use http://localhost:3112 as its public origin.');
  if (environment.NODE_ENV && environment.NODE_ENV !== 'development')
    throw new Error('Local demo runs only in development mode.');

  const {
    NODE_ENV: _nodeEnvironment,
    TASK30_LOCAL_REQUEST_ORIGIN: _task30Origin,
    TRYOUTFLOW_BOT_PROTECTION_MODE: _testBotMode,
    TRYOUTFLOW_SERVER_TEST_ENV: _testEnvironment,
    ...base
  } = environment;
  return {
    ...base,
    NEXT_PUBLIC_APP_URL: LOCAL_DEMO_ORIGIN,
    NEXT_PUBLIC_SUPABASE_URL: api.origin,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: status.serviceRoleKey,
    ABUSE_PROTECTION_HMAC_SECRET:
      environment.ABUSE_PROTECTION_HMAC_SECRET ?? LOCAL_DEMO_RATE_LIMIT_SECRET,
    PUBLIC_REGISTRATION_RATE_LIMIT_SECRET:
      environment.PUBLIC_REGISTRATION_RATE_LIMIT_SECRET ?? LOCAL_DEMO_RATE_LIMIT_SECRET,
    NEXT_PUBLIC_TRYOUTFLOW_LOCAL_DEMO_MODE: 'true',
  };
}

async function main() {
  const status = localStatus();
  const environment = createLocalDemoEnvironment(status);
  await ensureLocalDemoUser(environment);
  const child = spawn(
    process.execPath,
    [
      resolve('node_modules/next/dist/bin/next'),
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3112',
    ],
    { env: environment, stdio: 'inherit' },
  );
  child.once('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Local demo startup failed.'}\n`,
    );
    process.exitCode = 1;
  });
}
