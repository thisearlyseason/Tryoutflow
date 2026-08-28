import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function psql(sql: string) {
  return execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql]);
}

describe('rubric publication concurrency', () => {
  it('cannot publish an invalid total while a concurrent category edit holds the version lock', async () => {
    const organizationId = randomUUID();
    const ownerId = randomUUID();
    const tryoutId = randomUUID();
    const rubricId = randomUUID();
    const versionId = randomUUID();
    const categoryId = randomUUID();
    const secondCategoryId = randomUUID();

    try {
      await psql(`
        insert into auth.users (id) values ('${ownerId}');
        insert into public.organizations (id, name, slug, timezone)
          values ('${organizationId}', 'Concurrent Club', 'concurrent-club', 'America/Edmonton');
        insert into public.organization_members (organization_id, user_id, role)
          values ('${organizationId}', '${ownerId}', 'owner');
        insert into public.tryouts (id, organization_id, name, slug, sport, timezone)
          values ('${tryoutId}', '${organizationId}', 'Concurrent Camp', 'concurrent-camp', 'Hockey', 'America/Edmonton');
        insert into public.rubrics (id, organization_id, tryout_id, name)
          values ('${rubricId}', '${organizationId}', '${tryoutId}', 'Concurrent rubric');
        insert into public.rubric_versions (id, organization_id, tryout_id, rubric_id, version_number)
          values ('${versionId}', '${organizationId}', '${tryoutId}', '${rubricId}', 1);
        insert into public.rubric_categories (id, organization_id, tryout_id, rubric_version_id, name, sort_order, weight, scale_min, scale_max)
          values
            ('${categoryId}', '${organizationId}', '${tryoutId}', '${versionId}', 'Speed', 0, 60, 1, 5),
            ('${secondCategoryId}', '${organizationId}', '${tryoutId}', '${versionId}', 'Edges', 1, 40, 1, 5);
      `);

      const editor = psql(`
        begin;
        update public.rubric_categories set weight = 70 where id = '${categoryId}';
        select pg_sleep(0.5);
        commit;
      `);
      await new Promise((resolve) => setTimeout(resolve, 75));
      const publisher = psql(`
        set request.jwt.claim.sub = '${ownerId}';
        select outcome from public.publish_rubric_version('${organizationId}', '${rubricId}', 1);
      `);
      const [, publication] = await Promise.all([editor, publisher]);

      const status = await psql(
        `select status from public.rubric_versions where id = '${versionId}'`,
      );
      expect(status.stdout.trim()).toBe('draft');
      expect(publication.stdout).toContain('invalid_draft');
    } finally {
      await psql(`
        set session_replication_role = replica;
        delete from public.organizations where id = '${organizationId}';
        delete from auth.users where id = '${ownerId}';
      `);
    }
  });
});
