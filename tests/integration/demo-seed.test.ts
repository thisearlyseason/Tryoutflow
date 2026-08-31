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

function psqlTransaction(sql: string): string {
  return execFileSync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', 'begin', '-c', sql, '-c', 'rollback'],
    { encoding: 'utf8' },
  ).trim();
}

function jsonResult(output: string): unknown {
  const line = output
    .split('\n')
    .reverse()
    .find((candidate) => candidate.startsWith('{'));
  if (!line) throw new Error('SQL command did not return a JSON object');
  return JSON.parse(line);
}

describe('deterministic Badlands demo seed', () => {
  it('contains realistic edge cases without live contact data', () => {
    const facts = JSON.parse(
      psql(`select jsonb_build_object(
        'organization',(select name from public.organizations where id='29000000-0000-4000-8000-000000000001'),
        'positions',(select count(*) from public.tryout_positions where tryout_id='29000000-0000-4000-8000-000000000032'),
        'sessions',(select count(*) from public.tryout_sessions where tryout_id='29000000-0000-4000-8000-000000000032'),
        'evaluators',(select count(*) from public.tryout_staff_assignments where organization_id='29000000-0000-4000-8000-000000000001' and role='evaluator' and revoked_at is null),
        'incompleteEvaluations',(select count(*) from public.evaluations where tryout_id='29000000-0000-4000-8000-000000000032' and state in ('draft','reopened')),
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
      evaluators: 4,
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

  it('preserves legacy immutable bytes and exact canonical lineage cardinalities on replay', () => {
    const before =
      psql(`select encode(extensions.digest(string_agg(row_data,'|' order by row_data),'sha256'),'hex')
      from (
        select id::text||':'||given_name||':'||family_name row_data from public.athletes where organization_id='29000000-0000-4000-8000-000000000001'
        union all select id::text||':'||state||':'||version||':'||coalesce(finalized_at::text,'') from public.roster_versions where organization_id='29000000-0000-4000-8000-000000000001'
        union all select id::text||':'||state from public.integration_sync_jobs where organization_id='29000000-0000-4000-8000-000000000001'
        union all select id::text||':'||status from public.rubric_versions where id='29000000-0000-4000-8000-000000000213'
        union all select 'legacy-published-rubric:'||status||':'||coalesce(published_at::text,'') from public.rubric_versions where id='29000000-0000-4000-8000-000000000054'
        union all select 'legacy-published-category:'||id::text||':'||name||':'||weight::text||':'||scale_min::text||':'||scale_max::text from public.rubric_categories where rubric_version_id='29000000-0000-4000-8000-000000000054'
        union all select 'canonical-lineage:'||count(*)::text from public.rubric_versions where id='29000000-0000-4000-8000-000000000213'
        union all select 'canonical-lineage:'||count(*)::text from public.evaluations where tryout_id='29000000-0000-4000-8000-000000000201'
        union all select 'canonical-lineage:'||count(*)::text from public.roster_versions where id='29000000-0000-4000-8000-000000000283'
        union all select id::text||':'||state||':'||version from public.evaluations where id in ('29000000-0000-4000-8000-000000000261','29000000-0000-4000-8000-000000000262')
        union all select roster_version_id::text||':'||item_count from private.roster_report_snapshots where roster_version_id='29000000-0000-4000-8000-000000000283'
      ) stable`);
    execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl, '-f', 'supabase/seed.sql'], {
      encoding: 'utf8',
    });
    const after =
      psql(`select encode(extensions.digest(string_agg(row_data,'|' order by row_data),'sha256'),'hex')
      from (
        select id::text||':'||given_name||':'||family_name row_data from public.athletes where organization_id='29000000-0000-4000-8000-000000000001'
        union all select id::text||':'||state||':'||version||':'||coalesce(finalized_at::text,'') from public.roster_versions where organization_id='29000000-0000-4000-8000-000000000001'
        union all select id::text||':'||state from public.integration_sync_jobs where organization_id='29000000-0000-4000-8000-000000000001'
        union all select id::text||':'||status from public.rubric_versions where id='29000000-0000-4000-8000-000000000213'
        union all select 'legacy-published-rubric:'||status||':'||coalesce(published_at::text,'') from public.rubric_versions where id='29000000-0000-4000-8000-000000000054'
        union all select 'legacy-published-category:'||id::text||':'||name||':'||weight::text||':'||scale_min::text||':'||scale_max::text from public.rubric_categories where rubric_version_id='29000000-0000-4000-8000-000000000054'
        union all select 'canonical-lineage:'||count(*)::text from public.rubric_versions where id='29000000-0000-4000-8000-000000000213'
        union all select 'canonical-lineage:'||count(*)::text from public.evaluations where tryout_id='29000000-0000-4000-8000-000000000201'
        union all select 'canonical-lineage:'||count(*)::text from public.roster_versions where id='29000000-0000-4000-8000-000000000283'
        union all select id::text||':'||state||':'||version from public.evaluations where id in ('29000000-0000-4000-8000-000000000261','29000000-0000-4000-8000-000000000262')
        union all select roster_version_id::text||':'||item_count from private.roster_report_snapshots where roster_version_id='29000000-0000-4000-8000-000000000283'
      ) stable`);
    expect(after).toBe(before);
  });

  it('adds one immutable-safe current lineage beside pre-fix history', () => {
    expect(
      JSON.parse(
        psql(`select jsonb_build_object(
          'rubric',(select count(*) from public.rubric_categories where rubric_version_id='29000000-0000-4000-8000-000000000213'),
          'weights',(select string_agg(weight::text,',' order by sort_order) from public.rubric_categories where rubric_version_id='29000000-0000-4000-8000-000000000213'),
          'complete',(select state from public.evaluations where id='29000000-0000-4000-8000-000000000261'),
          'incomplete',(select state from public.evaluations where id='29000000-0000-4000-8000-000000000262'),
          'snapshot',(select count(*) from private.roster_report_snapshots where roster_version_id='29000000-0000-4000-8000-000000000283'),
          'versions',(select count(*) from public.roster_versions where tryout_id='29000000-0000-4000-8000-000000000201'),
          'rubricVersions',(select count(*) from public.rubric_versions where id='29000000-0000-4000-8000-000000000213'),
          'evaluations',(select count(*) from public.evaluations where tryout_id='29000000-0000-4000-8000-000000000201'),
          'teams',(select count(*) from public.tryout_teams where id='29000000-0000-4000-8000-000000000281'),
          'activeEvaluators',(select count(*) from public.tryout_staff_assignments where tryout_id='29000000-0000-4000-8000-000000000201' and role='evaluator' and revoked_at is null)
        )`),
      ),
    ).toEqual({
      rubric: 2,
      weights: '90.00,10.00',
      complete: 'completed',
      incomplete: 'draft',
      snapshot: 1,
      versions: 2,
      rubricVersions: 1,
      evaluations: 2,
      teams: 1,
      activeEvaluators: 2,
    });
  });

  it('converges deleted and corrupted mutable demo subsets while terminal sync payloads stay redacted', () => {
    psql(`update public.athletes set given_name='Corrupted' where id='29000000-0000-4000-8000-000000000061';
      delete from public.tryout_setup_progress where id='29000000-0000-4000-8000-000000000171';
      update public.integration_sync_jobs set approved_projection='[]' where id='29000000-0000-4000-8000-000000000162';
      delete from public.integration_sync_items where sync_job_id in ('29000000-0000-4000-8000-000000000162','29000000-0000-4000-8000-000000000163');
      delete from public.external_entity_mappings where connection_id='29000000-0000-4000-8000-000000000161'`);
    execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl, '-f', 'supabase/seed.sql'], {
      encoding: 'utf8',
    });
    expect(
      JSON.parse(
        psql(`select jsonb_build_object(
          'name',(select given_name from public.athletes where id='29000000-0000-4000-8000-000000000061'),
          'setup',(select count(*) from public.tryout_setup_progress where id='29000000-0000-4000-8000-000000000171'),
          'redacted',(select count(*) from public.integration_sync_jobs where id in ('29000000-0000-4000-8000-000000000162','29000000-0000-4000-8000-000000000163')
            and approved_projection='[]'::jsonb and provider_preview_id is null and provider_confirmation_token is null and roster_snapshot is null),
          'items',(select count(*) from public.integration_sync_items where sync_job_id in ('29000000-0000-4000-8000-000000000162','29000000-0000-4000-8000-000000000163')),
          'mappings',(select count(*) from public.external_entity_mappings where connection_id='29000000-0000-4000-8000-000000000161')
        )`),
      ),
    ).toEqual({ name: 'Avery', setup: 1, redacted: 2, items: 2, mappings: 1 });
  });

  it('keeps a finalized roster projection unchanged when live identity and number records change', () => {
    const result = jsonResult(
      psqlTransaction(`set local role authenticated;
        select set_config('request.jwt.claim.sub','29000000-0000-4000-8000-000000000011',true);
        create temporary table before_export as select result from public.load_report_export(
          '29000000-0000-4000-8000-000000000001','roster','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000153',5000);
        reset role;
        update public.athletes set given_name='Changed after finalization' where id='29000000-0000-4000-8000-000000000061';
        update public.tryout_numbers set released_at='2026-08-29 00:00:00+00' where registration_id='29000000-0000-4000-8000-000000000071';
        set local role authenticated;
        select set_config('request.jwt.claim.sub','29000000-0000-4000-8000-000000000011',true);
        select jsonb_build_object('same',(select result from before_export)=(select result from public.load_report_export(
          '29000000-0000-4000-8000-000000000001','roster','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000153',5000)));`),
    );
    expect(result).toEqual({ same: true });
  });

  it('rejects finalized decision/team mutations and captures a distinct correction snapshot', () => {
    expect(() =>
      psqlTransaction(`update public.roster_decisions set status='released'
        where roster_version_id='29000000-0000-4000-8000-000000000153'
          and registration_id='29000000-0000-4000-8000-000000000071'`),
    ).toThrow(/finalized roster snapshots are immutable/iu);
    expect(() =>
      psqlTransaction(`update public.tryout_teams set name='Changed live team'
        where id='29000000-0000-4000-8000-000000000151'`),
    ).toThrow(/teams in finalized rosters are immutable/iu);

    const result = jsonResult(
      psqlTransaction(`delete from public.roster_versions where id='29000000-0000-4000-8000-000000000155';
        set local role authenticated;
        select set_config('request.jwt.claim.sub','29000000-0000-4000-8000-000000000011',true);
        create temporary table original as select result from public.load_report_export(
          '29000000-0000-4000-8000-000000000001','roster','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000153',5000);
        create temporary table revised as select roster_version_id from public.revise_roster_version(
          '29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000033',
          '29000000-0000-4000-8000-000000000153',2,'Synthetic correction changes a final selection.','REVISE ROSTER');
        select * from public.change_roster_decisions(
          '29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000033',
          (select roster_version_id from revised),
          '[{"registrationId":"29000000-0000-4000-8000-000000000071","status":"released"}]',1,'CONFIRM DECISIONS');
        select * from public.move_roster_athlete(
          '29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000033',
          (select roster_version_id from revised),'29000000-0000-4000-8000-000000000071','29000000-0000-4000-8000-000000000152',2);
        select * from public.finalize_roster_version(
          '29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000033',
          (select roster_version_id from revised),3,'FINALIZE ROSTER');
        select jsonb_build_object(
          'originalUnchanged',(select result from original)=(select result from public.load_report_export(
            '29000000-0000-4000-8000-000000000001','roster','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000153',5000)),
          'revisionDiffers',(select result from original)<>(select result from public.load_report_export(
            '29000000-0000-4000-8000-000000000001','roster','29000000-0000-4000-8000-000000000032',(select roster_version_id from revised),5000)),
          'revisedRow',(select item from public.load_report_export(
            '29000000-0000-4000-8000-000000000001','roster','29000000-0000-4000-8000-000000000032',(select roster_version_id from revised),5000),
            jsonb_array_elements(result#>'{snapshot,rows}') item where item->>'preferredName'='Avery')
        );`),
    );
    expect(result).toMatchObject({
      originalUnchanged: true,
      revisionDiffers: true,
      revisedRow: { decision: 'released', team: 'Badlands Gold' },
    });
  });

  it('uses the same all-athlete population for organization summary and export', () => {
    const result = jsonResult(
      psqlTransaction(`insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date)
        values('29000000-0000-4000-8000-000000000099','29000000-0000-4000-8000-000000000001','Unregistered','Synthetic','unregistered','synthetic','2012-09-09');
        set local role authenticated;
        select set_config('request.jwt.claim.sub','29000000-0000-4000-8000-000000000011',true);
        with exported as (select result from public.load_report_export('29000000-0000-4000-8000-000000000001','athletes',null,null,5000)),
        summary as (select result from public.load_report_summary('29000000-0000-4000-8000-000000000001',null))
        select jsonb_build_object(
          'summary',(select (result#>>'{summary,athleteCount}')::int from summary),
          'rows',(select jsonb_array_length(result->'rows') from exported),
          'unregistered',(select item->'registrationStatus' from exported,jsonb_array_elements(result->'rows') item where item->>'preferredName'='Unregistered')
        );`),
    );
    expect(result).toEqual({ summary: 8, rows: 8, unregistered: null });
  });

  it('uses the canonical current lineage for valid weighted totals and immutable roster snapshots', () => {
    const result = jsonResult(
      psqlTransaction(`set local role authenticated;
        select set_config('request.jwt.claim.sub','29000000-0000-4000-8000-000000000011',true);
        with exported as (select result from public.load_report_export(
          '29000000-0000-4000-8000-000000000001','evaluations','29000000-0000-4000-8000-000000000201',null,5000)),
        roster as (select result from public.load_report_export(
          '29000000-0000-4000-8000-000000000001','roster','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000283',5000))
        select jsonb_build_object(
          'weighted',(select item->>'overallScore' from exported,jsonb_array_elements(result->'rows') item where item->>'preferredName'='Avery' and item->>'session'='Converged Skills'),
          'completed',(select (item->>'completedCount')::int from exported,jsonb_array_elements(result->'rows') item where item->>'preferredName'='Avery' and item->>'session'='Converged Skills'),
          'invalid',(select (item->>'invalidCount')::int from exported,jsonb_array_elements(result->'rows') item where item->>'preferredName'='Avery' and item->>'session'='Converged Skills'),
          'draft',(select (item->>'draftCount')::int from exported,jsonb_array_elements(result->'rows') item where item->>'preferredName'='Blake' and item->>'session'='Converged Scrimmage'),
          'snapshotRows',(select jsonb_array_length(result#>'{snapshot,rows}') from roster)
        );`),
    );
    expect(result).toEqual({
      weighted: '92.0000',
      completed: 1,
      invalid: 0,
      draft: 1,
      snapshotRows: 2,
    });
  });

  it('keeps the canonical verified roster downloadable beside a legacy unavailable final for managers and reviewers', () => {
    const result = jsonResult(
      psqlTransaction(`insert into public.tryout_staff_assignments(
          id,organization_id,user_id,role,scope_kind,tryout_id,granted_by_user_id,created_at,updated_at)
        values('29000000-0000-4000-8000-000000000286','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000012',
          'reviewer','tryout','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000011',
          '2026-08-28 18:00:00+00','2026-08-28 18:00:00+00');
        set local role authenticated;
        select set_config('request.jwt.claim.sub','29000000-0000-4000-8000-000000000011',true);
        create temporary table manager_summary as select result from public.load_report_summary(
          '29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201');
        reset role;
        set local role authenticated;
        select set_config('request.jwt.claim.sub','29000000-0000-4000-8000-000000000012',true);
        create temporary table reviewer_summary as select result from public.load_report_summary(
          '29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201');
        select jsonb_build_object(
          'managerRoster',(select result->'summary'->>'latestFinalizedRosterId' from manager_summary),
          'managerUnavailable',(select (result#>>'{summary,unavailableFinalizedRosterCount}')::int from manager_summary),
          'reviewerRoster',(select result->>'rosterVersionId' from reviewer_summary),
          'reviewerUnavailable',(select (result->>'unavailableFinalizedRosterCount')::int from reviewer_summary)
        );`),
    );
    expect(result).toEqual({
      managerRoster: '29000000-0000-4000-8000-000000000283',
      managerUnavailable: 1,
      reviewerRoster: '29000000-0000-4000-8000-000000000283',
      reviewerUnavailable: 1,
    });
  });
});
