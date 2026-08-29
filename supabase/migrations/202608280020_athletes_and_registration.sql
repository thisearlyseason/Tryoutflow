-- Public registration is deliberately a single, server-controlled transaction.
-- The exposed read function contains only publishable configuration; no PII table
-- receives an anonymous RLS policy.

-- The public route intentionally contains only a tryout slug. Make a published
-- slug globally unambiguous so that public lookup can never cross tenants.
create unique index tryouts_published_public_slug_key on public.tryouts (slug)
where status = 'published';

create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  given_name text not null,
  family_name text not null,
  normalized_given_name text not null,
  normalized_family_name text not null,
  birth_date date not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint athletes_organization_id_id_key unique (organization_id, id),
  constraint athletes_given_name_check check (char_length(trim(given_name)) between 1 and 120),
  constraint athletes_family_name_check check (char_length(trim(family_name)) between 1 and 120),
  constraint athletes_normalized_name_check check (normalized_given_name <> '' and normalized_family_name <> ''),
  constraint athletes_birth_date_check check (birth_date <= current_date)
);
create index athletes_duplicate_lookup_idx on public.athletes (organization_id, normalized_given_name, normalized_family_name, birth_date);
create trigger set_athletes_updated_at before update on public.athletes for each row execute function public.set_updated_at();

create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  email extensions.citext not null,
  normalized_email text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint guardians_organization_id_id_key unique (organization_id, id),
  constraint guardians_name_check check (char_length(trim(name)) between 1 and 160),
  constraint guardians_email_check check (normalized_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
);
create index guardians_duplicate_lookup_idx on public.guardians (organization_id, normalized_email);
create trigger set_guardians_updated_at before update on public.guardians for each row execute function public.set_updated_at();

create table public.athlete_guardians (
  organization_id uuid not null,
  athlete_id uuid not null,
  guardian_id uuid not null,
  relationship_label text not null default 'guardian',
  is_primary_contact boolean not null default true,
  communication_permitted boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, athlete_id, guardian_id),
  constraint athlete_guardians_athlete_fkey foreign key (organization_id, athlete_id) references public.athletes (organization_id, id) on delete cascade,
  constraint athlete_guardians_guardian_fkey foreign key (organization_id, guardian_id) references public.guardians (organization_id, id) on delete cascade,
  constraint athlete_guardians_relationship_check check (char_length(trim(relationship_label)) between 1 and 80)
);
create unique index athlete_guardians_one_primary_contact_idx on public.athlete_guardians (organization_id, athlete_id) where is_primary_contact;

create table public.tryout_registrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  athlete_id uuid not null,
  division_id uuid not null,
  registration_form_version_id uuid not null,
  responses jsonb not null,
  source text not null default 'public',
  status text not null default 'submitted',
  submission_key_digest text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint tryout_registrations_organization_id_id_key unique (organization_id, id),
  constraint tryout_registrations_tryout_fkey foreign key (organization_id, tryout_id) references public.tryouts (organization_id, id) on delete cascade,
  constraint tryout_registrations_athlete_fkey foreign key (organization_id, athlete_id) references public.athletes (organization_id, id) on delete restrict,
  constraint tryout_registrations_division_fkey foreign key (organization_id, tryout_id, division_id) references public.tryout_divisions (organization_id, tryout_id, id) on delete restrict,
  constraint tryout_registrations_form_version_fkey foreign key (organization_id, tryout_id, registration_form_version_id) references public.registration_form_versions (organization_id, tryout_id, id) on delete restrict,
  constraint tryout_registrations_responses_object check (jsonb_typeof(responses) = 'object'),
  constraint tryout_registrations_source_check check (source in ('public', 'staff', 'import')),
  constraint tryout_registrations_status_check check (status in ('submitted', 'withdrawn', 'cancelled')),
  constraint tryout_registrations_submission_key_digest_check check (submission_key_digest ~ '^[0-9a-f]{64}$'),
  constraint tryout_registrations_idempotency_key unique (organization_id, tryout_id, submission_key_digest)
);
create index tryout_registrations_tryout_division_idx on public.tryout_registrations (organization_id, tryout_id, division_id, created_at);
create trigger set_tryout_registrations_updated_at before update on public.tryout_registrations for each row execute function public.set_updated_at();

alter table public.tryout_staff_assignments
  add constraint tryout_staff_assignments_athlete_fkey foreign key (organization_id, athlete_id)
    references public.athletes (organization_id, id) on delete cascade;

create table public.session_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  registration_id uuid not null,
  session_id uuid not null,
  group_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint session_enrollments_organization_id_id_key unique (organization_id, id),
  constraint session_enrollments_registration_fkey foreign key (organization_id, registration_id) references public.tryout_registrations (organization_id, id) on delete cascade,
  constraint session_enrollments_session_fkey foreign key (organization_id, tryout_id, session_id) references public.tryout_sessions (organization_id, tryout_id, id) on delete restrict,
  constraint session_enrollments_group_fkey foreign key (organization_id, tryout_id, session_id, group_id) references public.session_groups (organization_id, tryout_id, session_id, id) on delete restrict,
  constraint session_enrollments_registration_session_key unique (organization_id, registration_id, session_id)
);
create trigger set_session_enrollments_updated_at before update on public.session_enrollments for each row execute function public.set_updated_at();

create table public.registration_duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  registration_id uuid not null,
  candidate_athlete_id uuid not null,
  reason text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint registration_duplicate_candidates_organization_id_id_key unique (organization_id, id),
  constraint registration_duplicate_candidates_registration_fkey foreign key (organization_id, registration_id) references public.tryout_registrations (organization_id, id) on delete cascade,
  constraint registration_duplicate_candidates_athlete_fkey foreign key (organization_id, candidate_athlete_id) references public.athletes (organization_id, id) on delete restrict,
  constraint registration_duplicate_candidates_reason_check check (reason in ('name_birthdate_guardian_email')),
  constraint registration_duplicate_candidates_unique_key unique (organization_id, registration_id, candidate_athlete_id, reason)
);

create table public.registration_confirmation_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  registration_id uuid not null,
  token_digest text not null,
  purpose text not null default 'registration_confirmation',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint registration_confirmation_tokens_registration_fkey foreign key (organization_id, registration_id) references public.tryout_registrations (organization_id, id) on delete cascade,
  constraint registration_confirmation_tokens_digest_key unique (token_digest),
  constraint registration_confirmation_tokens_digest_check check (token_digest ~ '^[0-9a-f]{64}$'),
  constraint registration_confirmation_tokens_purpose_check check (purpose = 'registration_confirmation'),
  constraint registration_confirmation_tokens_expiry_check check (expires_at > created_at)
);
create unique index registration_confirmation_tokens_active_registration_idx on public.registration_confirmation_tokens (organization_id, registration_id, purpose) where used_at is null;

create table public.registration_rate_counters (
  key_hash text primary key,
  attempts integer not null default 0,
  window_started_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint registration_rate_counters_key_hash_check check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint registration_rate_counters_attempts_check check (attempts >= 0 and attempts <= 100),
  constraint registration_rate_counters_expiry_check check (expires_at > window_started_at)
);
create index registration_rate_counters_expiry_idx on public.registration_rate_counters (expires_at);
create trigger set_registration_rate_counters_updated_at before update on public.registration_rate_counters for each row execute function public.set_updated_at();

alter table public.athletes enable row level security;
alter table public.guardians enable row level security;
alter table public.athlete_guardians enable row level security;
alter table public.tryout_registrations enable row level security;
alter table public.session_enrollments enable row level security;
alter table public.registration_duplicate_candidates enable row level security;
alter table public.registration_confirmation_tokens enable row level security;
alter table public.registration_rate_counters enable row level security;

create policy athletes_select_authorized on public.athletes for select to authenticated using (public.is_active_organization_member(organization_id));
create policy athletes_manage_administrators on public.athletes for all to authenticated using (public.is_active_organization_member(organization_id, array['owner', 'administrator'])) with check (public.is_active_organization_member(organization_id, array['owner', 'administrator']));
create policy guardians_select_administrators on public.guardians for select to authenticated using (public.is_active_organization_member(organization_id, array['owner', 'administrator']));
create policy guardians_manage_administrators on public.guardians for all to authenticated using (public.is_active_organization_member(organization_id, array['owner', 'administrator'])) with check (public.is_active_organization_member(organization_id, array['owner', 'administrator']));
create policy athlete_guardians_select_administrators on public.athlete_guardians for select to authenticated using (public.is_active_organization_member(organization_id, array['owner', 'administrator']));
create policy athlete_guardians_manage_administrators on public.athlete_guardians for all to authenticated using (public.is_active_organization_member(organization_id, array['owner', 'administrator'])) with check (public.is_active_organization_member(organization_id, array['owner', 'administrator']));
create policy registrations_select_authorized on public.tryout_registrations for select to authenticated using (public.can_read_tryout_configuration(organization_id, tryout_id, division_id));
create policy registrations_manage_administrators on public.tryout_registrations for all to authenticated using (public.is_active_organization_member(organization_id, array['owner', 'administrator'])) with check (public.is_active_organization_member(organization_id, array['owner', 'administrator']));
create policy session_enrollments_select_authorized on public.session_enrollments for select to authenticated using (public.can_read_tryout_configuration(organization_id, tryout_id));
create policy duplicate_candidates_select_administrators on public.registration_duplicate_candidates for select to authenticated using (public.is_active_organization_member(organization_id, array['owner', 'administrator']));

create function public.normalize_registration_text(value text)
returns text language sql immutable set search_path = '' as $$
  select lower(regexp_replace(trim(value), '\\s+', ' ', 'g'));
$$;

create function public.public_registration_tryout(p_tryout_slug text)
returns table (tryout_id uuid, name text, slug text, form_schema jsonb, divisions jsonb)
language sql stable security definer set search_path = '' as $$
  select target.id, target.name, target.slug, version.schema,
    coalesce(jsonb_agg(jsonb_build_object('id', division.id, 'name', division.name) order by division.sort_order) filter (where division.id is not null), '[]'::jsonb)
  from public.tryouts target
  join public.tryout_registration_form_selections selection on selection.organization_id=target.organization_id and selection.tryout_id=target.id
  join public.registration_form_versions version on version.organization_id=selection.organization_id and version.tryout_id=selection.tryout_id and version.id=selection.registration_form_version_id and version.status='published'
  left join public.tryout_divisions division on division.organization_id=target.organization_id and division.tryout_id=target.id
  where target.slug=p_tryout_slug and target.status='published'
    and target.registration_starts_at <= clock_timestamp() and target.registration_ends_at > clock_timestamp()
  group by target.id,target.name,target.slug,version.schema;
$$;

create function public.submit_public_registration(
  p_tryout_slug text,
  p_submission jsonb,
  p_idempotency_key text,
  p_rate_key_hash text
)
returns table (outcome text, registration_id uuid, confirmation_token text)
language plpgsql security definer set search_path = '' as $$
declare
  target public.tryouts%rowtype;
  version public.registration_form_versions%rowtype;
  selected_division uuid;
  athlete uuid;
  guardian uuid;
  registration uuid;
  raw_token text;
  field jsonb;
  answer jsonb;
  counter public.registration_rate_counters%rowtype;
  v_given_name text;
  v_family_name text;
  v_guardian_name text;
  v_guardian_email text;
  v_birth_date date;
  valid_key text;
begin
  if p_tryout_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or p_idempotency_key !~ '^[A-Za-z0-9_-]{24,200}$'
    or p_rate_key_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_submission) <> 'object'
  then raise exception 'invalid public registration request' using errcode='22023'; end if;
  if exists (select 1 from jsonb_object_keys(p_submission) as key where key not in ('givenName','familyName','birthDate','guardian','divisionId','responses')) then
    raise exception 'unknown registration field' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tryout_slug || ':' || p_idempotency_key, 0));
  valid_key := encode(extensions.digest(p_idempotency_key, 'sha256'), 'hex');
  select item.id into registration from public.tryout_registrations item
    join public.tryouts attempt on attempt.organization_id=item.organization_id and attempt.id=item.tryout_id
    where attempt.slug=p_tryout_slug and item.submission_key_digest=valid_key limit 1;
  if found then return query select 'replayed'::text, registration, null::text; return; end if;

  delete from public.registration_rate_counters where expires_at <= clock_timestamp();
  select * into counter from public.registration_rate_counters where key_hash=p_rate_key_hash for update;
  if found and counter.expires_at > clock_timestamp() then
    if counter.attempts >= 10 then return query select 'rate_limited'::text,null::uuid,null::text; return; end if;
    update public.registration_rate_counters set attempts=attempts+1 where key_hash=p_rate_key_hash;
  else
    insert into public.registration_rate_counters(key_hash,attempts,window_started_at,expires_at)
    values(p_rate_key_hash,1,clock_timestamp(),clock_timestamp()+interval '10 minutes')
    on conflict (key_hash) do update set attempts=1,window_started_at=excluded.window_started_at,expires_at=excluded.expires_at;
  end if;

  select * into target from public.tryouts where slug=p_tryout_slug and status='published'
    and registration_starts_at <= clock_timestamp() and registration_ends_at > clock_timestamp() for update;
  if not found then return query select 'registration_closed'::text,null::uuid,null::text; return; end if;
  select version_row.* into version from public.tryout_registration_form_selections selection
    join public.registration_form_versions version_row on version_row.organization_id=selection.organization_id and version_row.tryout_id=selection.tryout_id and version_row.id=selection.registration_form_version_id
    where selection.organization_id=target.organization_id and selection.tryout_id=target.id and version_row.status='published' for update of selection,version_row;
  if not found then return query select 'registration_closed'::text,null::uuid,null::text; return; end if;

  v_given_name := trim(coalesce(p_submission->>'givenName',''));
  v_family_name := trim(coalesce(p_submission->>'familyName',''));
  v_guardian_name := trim(coalesce(p_submission#>>'{guardian,name}',''));
  v_guardian_email := public.normalize_registration_text(coalesce(p_submission#>>'{guardian,email}',''));
  begin v_birth_date := (p_submission->>'birthDate')::date; exception when others then raise exception 'invalid athlete birth date' using errcode='22023'; end;
  if char_length(v_given_name) not between 1 and 120 or char_length(v_family_name) not between 1 and 120
    or char_length(v_guardian_name) not between 1 and 160 or v_guardian_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or v_birth_date > current_date
  then raise exception 'invalid athlete or guardian identity' using errcode='22023'; end if;
  if jsonb_typeof(p_submission->'responses') <> 'object' then raise exception 'invalid responses' using errcode='22023'; end if;
  if exists (select 1 from jsonb_object_keys(p_submission->'responses') response_key where not exists (select 1 from jsonb_array_elements(version.schema->'fields') item where item->>'key'=response_key)) then raise exception 'unknown registration response' using errcode='22023'; end if;
  for field in select value from jsonb_array_elements(version.schema->'fields') loop
    answer := p_submission->'responses'->(field->>'key');
    if (field->>'required')::boolean and (answer is null or answer='null'::jsonb or answer='""'::jsonb) then raise exception 'required registration response missing' using errcode='22023'; end if;
    if answer is null or answer='null'::jsonb then continue; end if;
    if field->>'kind' in ('consent','checkbox') and jsonb_typeof(answer) <> 'boolean' then raise exception 'invalid registration response' using errcode='22023'; end if;
    if field->>'kind'='consent' and (field->>'required')::boolean and answer <> 'true'::jsonb then raise exception 'required consent missing' using errcode='22023'; end if;
    if field->>'kind'='select' and (jsonb_typeof(answer) <> 'string' or not ((field->'options') ? (answer #>> '{}'))) then raise exception 'invalid registration response' using errcode='22023'; end if;
    if field->>'kind' in ('text','email','phone','date','textarea') and jsonb_typeof(answer) <> 'string' then raise exception 'invalid registration response' using errcode='22023'; end if;
  end loop;
  selected_division := nullif(p_submission->>'divisionId','')::uuid;
  if selected_division is null then select id into selected_division from public.tryout_divisions where organization_id=target.organization_id and tryout_id=target.id order by sort_order limit 1; end if;
  if not exists (select 1 from public.tryout_divisions where organization_id=target.organization_id and tryout_id=target.id and id=selected_division) then raise exception 'invalid division' using errcode='22023'; end if;

  insert into public.athletes(organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date)
    values(target.organization_id,v_given_name,v_family_name,public.normalize_registration_text(v_given_name),public.normalize_registration_text(v_family_name),v_birth_date) returning id into athlete;
  insert into public.guardians(organization_id,name,email,normalized_email) values(target.organization_id,v_guardian_name,v_guardian_email,v_guardian_email) returning id into guardian;
  insert into public.athlete_guardians(organization_id,athlete_id,guardian_id) values(target.organization_id,athlete,guardian);
  insert into public.tryout_registrations(organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest)
    values(target.organization_id,target.id,athlete,selected_division,version.id,p_submission->'responses',valid_key) returning id into registration;
  insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id)
    select target.organization_id,target.id,registration,session.id from public.tryout_sessions session where session.organization_id=target.organization_id and session.tryout_id=target.id and session.division_id=selected_division;
  insert into public.registration_duplicate_candidates(organization_id,registration_id,candidate_athlete_id,reason)
    select target.organization_id,registration,candidate.id,'name_birthdate_guardian_email'
    from public.athletes candidate join public.athlete_guardians link on link.organization_id=candidate.organization_id and link.athlete_id=candidate.id
      join public.guardians candidate_guardian on candidate_guardian.organization_id=link.organization_id and candidate_guardian.id=link.guardian_id
    where candidate.organization_id=target.organization_id and candidate.id<>athlete and candidate.normalized_given_name=public.normalize_registration_text(v_given_name)
      and candidate.normalized_family_name=public.normalize_registration_text(v_family_name) and candidate.birth_date=v_birth_date and candidate_guardian.normalized_email=v_guardian_email;
  raw_token := encode(extensions.gen_random_bytes(32),'hex');
  insert into public.registration_confirmation_tokens(organization_id,registration_id,token_digest,expires_at)
    values(target.organization_id,registration,encode(extensions.digest(raw_token,'sha256'),'hex'),clock_timestamp()+interval '7 days');
  return query select 'submitted'::text,registration,raw_token;
end;
$$;

revoke all on table public.athletes, public.guardians, public.athlete_guardians, public.tryout_registrations, public.session_enrollments, public.registration_duplicate_candidates, public.registration_confirmation_tokens, public.registration_rate_counters from anon;
revoke all on function public.public_registration_tryout(text) from public;
revoke all on function public.submit_public_registration(text,jsonb,text,text) from public;
revoke execute on function public.submit_public_registration(text,jsonb,text,text) from anon, authenticated;
grant execute on function public.public_registration_tryout(text) to anon, authenticated;
grant execute on function public.submit_public_registration(text,jsonb,text,text) to service_role;
