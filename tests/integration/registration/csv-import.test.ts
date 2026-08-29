// @vitest-environment node

import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

function psql(sql: string) {
  return execFileSync(
    'psql',
    ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
    { encoding: 'utf8', input: sql },
  ).trim();
}

describe('athlete CSV import transaction against local Supabase', () => {
  it('binds preview to actor and replays the exact commit without duplicate rows', () => {
    const output = psql(`
      begin;
      insert into auth.users(id) values ('16161616-1616-4616-8616-161616161616');
      insert into public.organizations(id,name,slug,timezone) values ('a1616161-1616-4616-8616-161616161616','Integration Import','integration-import','America/Edmonton');
      insert into public.organization_members(organization_id,user_id,role,status) values ('a1616161-1616-4616-8616-161616161616','16161616-1616-4616-8616-161616161616','owner','active');
      set local role authenticated;
      select set_config('request.jwt.claim.role','authenticated',true);
      select set_config('request.jwt.claim.sub','16161616-1616-4616-8616-161616161616',true);
      create temporary table p as select * from public.create_athlete_import_preview(
        'a1616161-1616-4616-8616-161616161616',repeat('e',64),
        '{"givenName":"First","familyName":"Last","birthDate":"DOB"}',
        '[{"row":2,"status":"valid","errors":[],"athlete":{"givenName":"Éva","familyName":" Nguyen ","birthDate":"2012-02-29"},"duplicateCandidateIds":[]}]'
      );
      select outcome from public.commit_athlete_import('a1616161-1616-4616-8616-161616161616',(select preview_id from p),array[2]);
      select outcome from public.commit_athlete_import('a1616161-1616-4616-8616-161616161616',(select preview_id from p),array[2]);
      select count(*)||':'||min(family_name) from public.athletes where organization_id='a1616161-1616-4616-8616-161616161616';
      rollback;
    `);
    expect(
      output.split('\n').filter((line) => ['committed', 'replayed', '1:Nguyen'].includes(line)),
    ).toEqual(['committed', 'replayed', '1:Nguyen']);
  });

  it('rejects a forged valid status and leaves the batch empty', () => {
    const output = psql(`
      begin;
      insert into auth.users(id) values ('17171717-1717-4717-8717-171717171717');
      insert into public.organizations(id,name,slug,timezone) values ('a1717171-1717-4717-8717-171717171717','Rollback Import','rollback-import','America/Edmonton');
      insert into public.organization_members(organization_id,user_id,role,status) values ('a1717171-1717-4717-8717-171717171717','17171717-1717-4717-8717-171717171717','administrator','active');
      set local role authenticated;
      select set_config('request.jwt.claim.role','authenticated',true);
      select set_config('request.jwt.claim.sub','17171717-1717-4717-8717-171717171717',true);
      create temporary table p as select * from public.create_athlete_import_preview(
        'a1717171-1717-4717-8717-171717171717',repeat('f',64),
        '{"givenName":"First","familyName":"Last","birthDate":"DOB"}',
        '[{"row":2,"status":"valid","errors":[],"athlete":{"givenName":"Valid","familyName":"Row","birthDate":"2012-01-01"},"duplicateCandidateIds":[]},{"row":3,"status":"valid","errors":[],"athlete":{"givenName":"Bad","familyName":"Date","birthDate":"2023-02-29"},"duplicateCandidateIds":[]}]'
      );
      select outcome from public.commit_athlete_import('a1717171-1717-4717-8717-171717171717',(select preview_id from p),array[2,3]);
      select count(*) from public.athletes where organization_id='a1717171-1717-4717-8717-171717171717';
      rollback;
    `);
    expect(output.split('\n').filter((line) => ['invalid_selection', '0'].includes(line))).toEqual([
      'invalid_selection',
      '0',
    ]);
  });
});
