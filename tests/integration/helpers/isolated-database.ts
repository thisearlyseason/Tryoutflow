import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dumpLocalSupabaseSchemas } from '../../../scripts/lib/local-supabase-database.mjs';

/** Empty local schema, with a run-owned name also covered by supervisor cleanup. */
export function isolatedDatabase() {
  const primary = process.env.SUPABASE_DB_URL;
  const runId = process.env.TRYOUTFLOW_INTEGRATION_RUN_ID;
  if (!primary || !runId || !/^[0-9a-f]{16}$/u.test(runId)) {
    throw new Error('Isolated database tests require the guarded integration runner.');
  }
  const name = `tryoutflow_fixture_${runId}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const url = new URL(primary);
  url.pathname = `/${name}`;
  let created = false;
  const sql = (target: string, command: string) =>
    execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', target, '-c', command], {
      stdio: 'pipe',
    });
  return {
    url: url.toString(),
    create() {
      // This helper proves the endpoint is the configured local Docker database.
      const schema = dumpLocalSupabaseSchemas(primary, ['public', 'private']);
      sql(primary, `create database ${name}`);
      created = true;
      sql(
        url.toString(),
        `
        drop schema public;
        create schema auth;
        create schema extensions;
        create table auth.users (
          id uuid primary key, email text, aud text, role text,
          email_confirmed_at timestamptz, created_at timestamptz, updated_at timestamptz
        );
        create function auth.uid() returns uuid language sql stable as
          'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
        create function auth.role() returns text language sql stable as
          'select nullif(current_setting(''request.jwt.claim.role'',true),'''')';
        create function auth.jwt() returns jsonb language sql stable as
          'select coalesce(nullif(current_setting(''request.jwt.claims'',true),'''')::jsonb,''{}''::jsonb)';
        create extension citext with schema extensions;
        create extension pgcrypto with schema extensions;
        create extension "uuid-ossp" with schema extensions;
      `,
      );
      execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', url.toString()], {
        input: schema,
        maxBuffer: 60 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    },
    drop() {
      if (created) sql(primary, `drop database if exists ${name} with (force)`);
    },
  };
}
