import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const ids = {
  organization: '81000000-0000-4000-8000-000000000001',
  tryout: '81000000-0000-4000-8000-000000000002',
  division: '81000000-0000-4000-8000-000000000003',
  form: '81000000-0000-4000-8000-000000000004',
  formVersion: '81000000-0000-4000-8000-000000000005',
  athlete: '81000000-0000-4000-8000-000000000006',
  registration: '20000000-0000-4000-8000-000000000001',
  team: '81000000-0000-4000-8000-000000000007',
  roster: '81000000-0000-4000-8000-000000000008',
} as const;

const email = `task27-browser-${randomUUID()}@example.test`;
const password = `Task27-${randomUUID()}!`;
let databaseUrl = '';
let ownerId = '';
const cleanupSql = `
  begin;
  alter table public.roster_versions disable trigger user;
  alter table public.roster_decisions disable trigger user;
  alter table public.roster_assignments disable trigger user;
  alter table public.tryout_teams disable trigger user;
  alter table public.audit_logs disable trigger user;
  alter table public.organization_members disable trigger user;
  alter table public.tryouts disable trigger user;
  alter table public.tryout_divisions disable trigger user;
  alter table public.registration_forms disable trigger user;
  alter table public.registration_form_versions disable trigger user;
  alter table public.athletes disable trigger user;
  alter table public.tryout_registrations disable trigger user;
  update public.integration_sync_jobs set source_preview_id=null where organization_id='${ids.organization}';
  update public.integration_export_previews set sync_job_id=null,consumed_at=null where organization_id='${ids.organization}';
  delete from public.integration_outbox_jobs where organization_id='${ids.organization}';
  delete from public.external_entity_mappings where organization_id='${ids.organization}';
  delete from public.integration_sync_items where organization_id='${ids.organization}';
  delete from public.integration_export_previews where organization_id='${ids.organization}';
  delete from public.integration_sync_jobs where organization_id='${ids.organization}';
  delete from public.integration_connections where organization_id='${ids.organization}';
  delete from public.audit_logs where organization_id='${ids.organization}';
  delete from public.roster_assignments where organization_id='${ids.organization}';
  delete from public.roster_decisions where organization_id='${ids.organization}';
  delete from public.roster_versions where organization_id='${ids.organization}';
  delete from public.tryout_teams where organization_id='${ids.organization}';
  delete from public.tryout_registrations where organization_id='${ids.organization}';
  delete from public.registration_form_versions where organization_id='${ids.organization}';
  delete from public.registration_forms where organization_id='${ids.organization}';
  delete from public.athletes where organization_id='${ids.organization}';
  delete from public.tryout_divisions where organization_id='${ids.organization}';
  delete from public.tryouts where organization_id='${ids.organization}';
  delete from public.organizations where id='${ids.organization}';
  alter table public.roster_versions enable trigger user;
  alter table public.roster_decisions enable trigger user;
  alter table public.roster_assignments enable trigger user;
  alter table public.tryout_teams enable trigger user;
  alter table public.audit_logs enable trigger user;
  alter table public.organization_members enable trigger user;
  alter table public.tryouts enable trigger user;
  alter table public.tryout_divisions enable trigger user;
  alter table public.registration_forms enable trigger user;
  alter table public.registration_form_versions enable trigger user;
  alter table public.athletes enable trigger user;
  alter table public.tryout_registrations enable trigger user;
  commit;
`;

test.beforeAll(async ({ request }) => {
  const local = JSON.parse(
    execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' }),
  ) as {
    API_URL: string;
    DB_URL: string;
    PUBLISHABLE_KEY: string;
    SERVICE_ROLE_KEY: string;
  };
  databaseUrl = local.DB_URL;
  const created = await request.post(`${local.API_URL}/auth/v1/admin/users`, {
    headers: {
      apikey: local.SERVICE_ROLE_KEY,
      authorization: `Bearer ${local.SERVICE_ROLE_KEY}`,
    },
    data: { email, password, email_confirm: true },
  });
  expect(created.ok(), await created.text()).toBe(true);
  ownerId = String(((await created.json()) as { id: unknown }).id);
  const signedIn = await request.post(`${local.API_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: local.PUBLISHABLE_KEY },
    data: { email, password },
  });
  expect(signedIn.ok(), await signedIn.text()).toBe(true);
  execFileSync('psql', [
    databaseUrl,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `
    ${cleanupSql}
    insert into public.organizations(id,name,slug) values('${ids.organization}','Task 27 Browser Club','task27-browser');
    insert into public.organization_members(organization_id,user_id,role,status) values('${ids.organization}','${ownerId}','owner','active');
    insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values('${ids.tryout}','${ids.organization}','Browser Tryout','browser-tryout','Hockey','America/Edmonton');
    insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values('${ids.division}','${ids.organization}','${ids.tryout}','U18',0);
    insert into public.registration_forms(id,organization_id,tryout_id,name) values('${ids.form}','${ids.organization}','${ids.tryout}','Form');
    insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
      values('${ids.formVersion}','${ids.organization}','${ids.tryout}','${ids.form}',1,'{"fields":[]}','published',clock_timestamp());
    insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date)
      values('${ids.athlete}','${ids.organization}','Browser','Athlete','browser','athlete','2010-01-01');
    insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest)
      values('${ids.registration}','${ids.organization}','${ids.tryout}','${ids.athlete}','${ids.division}','${ids.formVersion}','{}',repeat('a',64),repeat('1',64));
    set session_replication_role=replica;
    update public.tryouts set status='published',published_at=clock_timestamp() where id='${ids.tryout}';
    set session_replication_role=origin;
    insert into public.tryout_teams(id,organization_id,tryout_id,division_id,name,sort_order) values('${ids.team}','${ids.organization}','${ids.tryout}','${ids.division}','Blue',0);
    insert into public.roster_versions(id,organization_id,tryout_id,division_id,revision_number,state,version,created_by_user_id)
      values('${ids.roster}','${ids.organization}','${ids.tryout}','${ids.division}',1,'draft',1,'${ownerId}');
    insert into public.roster_decisions(organization_id,tryout_id,division_id,roster_version_id,registration_id)
      values('${ids.organization}','${ids.tryout}','${ids.division}','${ids.roster}','${ids.registration}');
    insert into public.roster_assignments(organization_id,tryout_id,division_id,roster_version_id,registration_id,team_id,assigned_by_user_id)
      values('${ids.organization}','${ids.tryout}','${ids.division}','${ids.roster}','${ids.registration}','${ids.team}','${ownerId}');
    update public.roster_versions set state='finalized',version=2,finalized_by_user_id='${ownerId}',finalized_at=clock_timestamp() where id='${ids.roster}';
  `,
  ]);
});

test.afterAll(() => {
  if (databaseUrl) {
    execFileSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-c', cleanupSql]);
  }
});

test('traverses production auth, registry, RPC, outbox worker, and refreshed durable truth', async ({
  page,
  request,
}) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app(?:\/|$)/u);

  await page.goto('/app/task27-browser/organization/integrations');
  await expect(page.getByText(/demo\/mock only/i).first()).toBeVisible();
  await page.getByRole('button', { name: 'Connect demo provider' }).click();
  await expect(page.getByText(/demo\/mock connection is ready/i)).toBeVisible();

  await page.goto(`/app/task27-browser/tryouts/${ids.tryout}/rosters`);
  await page.getByRole('link', { name: 'Export finalized roster' }).click();
  await page.getByLabel('External destination').selectOption('mock-team-blue');
  await page.getByLabel('First name').check();
  await page.getByLabel('Last name').check();
  await page.getByRole('button', { name: 'Preview export' }).click();
  await expect(page.getByText('Browser', { exact: true })).toBeVisible();
  await expect(page.getByText('Athlete', { exact: true })).toBeVisible();
  await page.getByLabel('I reviewed the exact destination and fields').check();
  await page.getByRole('button', { name: 'Confirm and queue export' }).click();
  await expect(page.getByRole('status')).toContainText('pending');

  const processed = await request.post('/api/jobs/process', {
    headers: { authorization: `Bearer ${'task27-browser-job-secret'.padEnd(40, 'x')}` },
    data: { batchSize: 5 },
  });
  expect(processed.ok(), await processed.text()).toBe(true);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('1 completed');
  await expect(page.getByRole('status')).toContainText('completed');
  expect(await new AxeBuilder({ page }).analyze()).toMatchObject({ violations: [] });
});
