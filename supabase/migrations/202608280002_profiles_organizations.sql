create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (
    display_name is null or char_length(trim(display_name)) between 1 and 120
  )
);

create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'America/Edmonton',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_length check (char_length(trim(name)) between 1 and 160),
  constraint organizations_slug_format check (public.is_valid_organization_slug(slug)),
  constraint organizations_status check (status in ('active', 'suspended'))
);

create trigger set_organizations_updated_at
before update on public.organizations
for each row
execute function public.set_updated_at();

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  occurred_at timestamptz not null default now(),
  constraint audit_logs_organization_id_id_key unique (organization_id, id),
  constraint audit_logs_action_not_blank check (char_length(trim(action)) > 0),
  constraint audit_logs_entity_type_not_blank check (char_length(trim(entity_type)) > 0)
);

create function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs are append-only' using errcode = '55000';
end;
$$;

create trigger prevent_audit_log_update
before update on public.audit_logs
for each row
execute function public.prevent_audit_log_mutation();

create trigger prevent_audit_log_delete
before delete on public.audit_logs
for each row
execute function public.prevent_audit_log_mutation();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.audit_logs enable row level security;
