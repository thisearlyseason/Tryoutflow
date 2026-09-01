import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createClient } from '@supabase/supabase-js';

export const DEMO_USER = Object.freeze({
  email: 'demo.owner@badlands.example.test',
  organizationId: '29000000-0000-4000-8000-000000000001',
  role: 'owner',
});

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function assertLocalSupabaseUrl(value) {
  const parsed = new URL(value);
  if (
    parsed.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
  ) {
    throw new Error('Demo provisioning is for local Supabase only.');
  }
  return parsed;
}

export function requireLocalDemoPassword(environment) {
  const value = environment.TRYOUTFLOW_LOCAL_DEMO_PASSWORD;
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    throw new Error('Set TRYOUTFLOW_LOCAL_DEMO_PASSWORD to a 12–128 character local password.');
  }
  return value;
}

function localStatus() {
  const raw = JSON.parse(
    execFileSync(resolve('node_modules/.bin/supabase'), ['status', '-o', 'json'], {
      encoding: 'utf8',
    }),
  );
  const apiUrl = String(raw.API_URL ?? '');
  const databaseUrl = String(raw.DB_URL ?? '');
  const serviceRoleKey = String(raw.SECRET_KEY ?? raw.SERVICE_ROLE_KEY ?? '');
  assertLocalSupabaseUrl(apiUrl);
  if (!databaseUrl || !serviceRoleKey) throw new Error('Local Supabase status is incomplete.');
  return { apiUrl, databaseUrl, serviceRoleKey };
}

async function findUser(client) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === DEMO_USER.email);
    if (found) return found;
    if (data.users.length < 100) return null;
  }
  throw new Error('Local Auth user list exceeded the supported demo bound.');
}

export async function ensureLocalDemoUser(environment = process.env) {
  const password = requireLocalDemoPassword(environment);
  const { apiUrl, databaseUrl, serviceRoleKey } = localStatus();
  const client = createClient(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const existing = await findUser(client);
  const result = existing
    ? await client.auth.admin.updateUserById(existing.id, {
        email: DEMO_USER.email,
        email_confirm: true,
        password,
      })
    : await client.auth.admin.createUser({
        email: DEMO_USER.email,
        email_confirm: true,
        password,
      });
  if (result.error) throw result.error;
  const userId = result.data.user?.id;
  if (!userId || !uuid.test(userId)) throw new Error('Local Auth returned an invalid user ID.');

  execFileSync(
    'psql',
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      databaseUrl,
      '-c',
      `insert into public.profiles(id,display_name)
       values('${userId}','Demo Owner')
       on conflict(id) do update set display_name=excluded.display_name;
       insert into public.organization_members(organization_id,user_id,role,status)
       values('${DEMO_USER.organizationId}','${userId}','owner','active')
       on conflict(organization_id,user_id)
       do update set role='owner',status='active';`,
    ],
    { stdio: 'pipe' },
  );
  return { email: DEMO_USER.email, organizationId: DEMO_USER.organizationId, userId };
}

async function main() {
  const result = await ensureLocalDemoUser();
  process.stdout.write(
    `Local demo owner ready: ${result.email}\nOrganization: badlands-hockey-academy\nPassword: value from TRYOUTFLOW_LOCAL_DEMO_PASSWORD\n`,
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Demo provisioning failed.'}\n`,
    );
    process.exitCode = 1;
  });
}
