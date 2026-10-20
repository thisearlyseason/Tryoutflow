// Local-only, fictional screenshot data. Never connects to a hosted project.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const status = JSON.parse(
  execFileSync('node_modules/.bin/supabase', ['status', '-o', 'json'], { encoding: 'utf8' }),
);
const apiUrl = new URL(status.API_URL);
const databaseUrl = new URL(status.DB_URL);
if (
  apiUrl.origin !== 'http://127.0.0.1:58321' ||
  databaseUrl.protocol !== 'postgresql:' ||
  databaseUrl.hostname !== '127.0.0.1' ||
  databaseUrl.port !== '58322' ||
  databaseUrl.pathname !== '/postgres'
)
  throw new Error('Local demo database required');
const sql = (statement) =>
  execFileSync('psql', ['-X', status.DB_URL, '-v', 'ON_ERROR_STOP=1', '-1', '-q'], {
    input: statement,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
let seed = readFileSync('supabase/seed.sql', 'utf8')
  .replaceAll('29000000-', '69000000-')
  .replaceAll('Badlands Hockey Academy', 'Prairie Hockey Club')
  .replaceAll('badlands', 'prairie-guide')
  .replaceAll('Synthetic', 'Example')
  .replaceAll('synthetic', 'example')
  .replaceAll('Converged', 'Spring')
  .replaceAll('converged', 'spring')
  .replaceAll('U15 Spring Demo', 'U15 Spring Development')
  .replaceAll(
    'Append-only deterministic convergence fixture.',
    'Skills and scrimmage sessions for our spring program.',
  )
  .replaceAll('Example edge-case demo tryout.', 'Fall player evaluations for Prairie Hockey Club.');
sql(seed);
sql(
  "update auth.users set instance_id='00000000-0000-0000-0000-000000000000', confirmation_token='', recovery_token='', email_change_token_new='', email_change='' where id::text like '69000000-%';",
);
const client = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const password = process.env.TRYOUTFLOW_GUIDE_PASSWORD;
if (!password || password.length < 12) throw new Error('Set a local guide password');
for (const [id, email, name] of [
  ['69000000-0000-4000-8000-000000000011', 'owner@prairie-guide.example.test', 'Jordan Carter'],
  [
    '69000000-0000-4000-8000-000000000013',
    'evaluator-one@prairie-guide.example.test',
    'Alex Morgan',
  ],
]) {
  const { error } = await client.auth.admin.updateUserById(id, { password, email_confirm: true });
  if (error) throw error;
  sql(`update public.profiles set display_name='${name}' where id='${id}';`);
}
const { data: users } = await client.auth.admin.listUsers({ perPage: 1000 });
let result = {};
for (const [role, email] of [
  ['parent', 'parent@prairie-guide.example.test'],
  ['newcoach', 'new-coach@prairie-guide.example.test'],
]) {
  let user = users.users.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
  } else {
    const { error } = await client.auth.admin.updateUserById(user.id, { password });
    if (error) throw error;
  }
  result[role] = { id: user.id, email };
}
// Seed one family portal through the same guarded record tables as the product.
sql(`select set_config('request.jwt.claim.sub','69000000-0000-4000-8000-000000000011',true);
insert into public.participant_links(organization_id,athlete_id,user_id,relationship) values('69000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000061','${result.parent.id}','guardian') on conflict do nothing;
insert into public.event_notices(id,organization_id,tryout_id,title,body,category,status,created_by) values('69000000-0000-4000-8000-000000000301','69000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000032','Arrival and equipment','Please arrive 30 minutes early at Rink A. Bring full hockey equipment, a water bottle and your registration confirmation.','arrival','published','69000000-0000-4000-8000-000000000011') on conflict do nothing;
insert into public.scouting_records(id,organization_id,athlete_id,kind,title,body,status,visibility,strengths,development_areas,recommendation,created_by) values('69000000-0000-4000-8000-000000000302','69000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000061','report','Fall evaluation feedback','Avery demonstrated strong effort and good communication throughout the sessions.','approved','athlete','Acceleration and puck control','Keep scanning before receiving a pass','Practice shoulder checks and join the next development session.','69000000-0000-4000-8000-000000000011') on conflict do nothing;
`);
writeFileSync(
  'output/how-to/demo.json',
  JSON.stringify({ organization: 'prairie-guide-hockey-academy', ...result }, null, 2),
);
console.log('Fictional guide workspace ready. Credentials remain local.');
