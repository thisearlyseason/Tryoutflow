// @vitest-environment node

import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim();
}

describe('deterministic Badlands demo seed', () => {
  it('contains realistic edge cases without live contact data', () => {
    const facts = JSON.parse(
      psql(`select jsonb_build_object(
        'organization',(select name from public.organizations where id='29000000-0000-4000-8000-000000000001'),
        'positions',(select count(*) from public.tryout_positions where organization_id='29000000-0000-4000-8000-000000000001'),
        'sessions',(select count(*) from public.tryout_sessions where organization_id='29000000-0000-4000-8000-000000000001'),
        'evaluators',(select count(*) from public.tryout_staff_assignments where organization_id='29000000-0000-4000-8000-000000000001' and role='evaluator' and revoked_at is null),
        'incompleteEvaluations',(select count(*) from public.evaluations where organization_id='29000000-0000-4000-8000-000000000001' and state in ('draft','reopened')),
        'decisionKinds',(select count(distinct status) from public.roster_decisions where organization_id='29000000-0000-4000-8000-000000000001'),
        'draftRoster',(select exists(select 1 from public.roster_versions where organization_id='29000000-0000-4000-8000-000000000001' and state='draft')),
        'finalRoster',(select exists(select 1 from public.roster_versions where organization_id='29000000-0000-4000-8000-000000000001' and state='finalized')),
        'failedSync',(select exists(select 1 from public.integration_sync_jobs where organization_id='29000000-0000-4000-8000-000000000001' and state in ('failed','needs_attention'))),
        'successfulSync',(select exists(select 1 from public.integration_sync_jobs where organization_id='29000000-0000-4000-8000-000000000001' and state='completed')),
        'genuineTie',(select exists(
          select 1 from public.evaluations a join public.evaluations b
            on b.organization_id=a.organization_id and b.id>a.id and b.state in ('completed','locked')
          where a.organization_id='29000000-0000-4000-8000-000000000001' and a.state in ('completed','locked')
            and (select jsonb_agg(s.value order by s.rubric_category_id) from public.evaluation_scores s where s.evaluation_id=a.id)
              =(select jsonb_agg(s.value order by s.rubric_category_id) from public.evaluation_scores s where s.evaluation_id=b.id)
        ))
      )`),
    );
    expect(facts).toMatchObject({
      organization: 'Badlands Hockey Academy',
      positions: 3,
      sessions: 2,
      evaluators: 2,
      incompleteEvaluations: 1,
      decisionKinds: 4,
      draftRoster: true,
      finalRoster: true,
      failedSync: true,
      successfulSync: true,
      genuineTie: true,
    });
    expect(
      Number(
        psql(`select count(*) from public.guardians where organization_id='29000000-0000-4000-8000-000000000001'
          and email::text !~ '@example\\.test$'`),
      ),
    ).toBe(0);
  });

  it('uses stable UUIDs and timestamps so repeating the seed is row-stable', () => {
    const before =
      psql(`select encode(extensions.digest(string_agg(row_data,'|' order by row_data),'sha256'),'hex')
      from (
        select id::text||':'||given_name||':'||family_name row_data from public.athletes where organization_id='29000000-0000-4000-8000-000000000001'
        union all select id::text||':'||state||':'||version from public.roster_versions where organization_id='29000000-0000-4000-8000-000000000001'
        union all select id::text||':'||state from public.integration_sync_jobs where organization_id='29000000-0000-4000-8000-000000000001'
      ) stable`);
    execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl, '-f', 'supabase/seed.sql'], {
      encoding: 'utf8',
    });
    const after =
      psql(`select encode(extensions.digest(string_agg(row_data,'|' order by row_data),'sha256'),'hex')
      from (
        select id::text||':'||given_name||':'||family_name row_data from public.athletes where organization_id='29000000-0000-4000-8000-000000000001'
        union all select id::text||':'||state||':'||version from public.roster_versions where organization_id='29000000-0000-4000-8000-000000000001'
        union all select id::text||':'||state from public.integration_sync_jobs where organization_id='29000000-0000-4000-8000-000000000001'
      ) stable`);
    expect(after).toBe(before);
  });
});
