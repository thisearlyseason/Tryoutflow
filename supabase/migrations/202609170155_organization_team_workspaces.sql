-- Team workspaces reuse the existing tenant boundary. Data is never reparented or merged.
alter table public.organizations add column parent_organization_id uuid references public.organizations(id) on delete restrict;
create index organizations_parent_workspace on public.organizations(parent_organization_id) where parent_organization_id is not null;
alter table public.organizations add constraint workspace_not_own_parent check(parent_organization_id is distinct from id);
alter table public.organization_members add column inherited_from_organization_id uuid references public.organizations(id) on delete restrict;

create function private.is_parent_workspace_manager(p_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organizations c join public.organization_members m on m.organization_id=c.parent_organization_id
 where c.id=p_org and m.user_id=auth.uid() and m.status='active' and m.role in ('owner','administrator'));
$$;

-- Keep the standalone resolver intact and inherit only an Organization grant, never a Pro/trial grant.
do $$ declare source text; begin
 select pg_get_functiondef('private.effective_billing_access(uuid,uuid)'::regprocedure) into source;
 execute replace(source,'FUNCTION private.effective_billing_access(', 'FUNCTION private.standalone_billing_access(');
end $$;
create or replace function private.effective_billing_access(p_org uuid,p_tryout uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare parent_id uuid; access jsonb;
begin
 select parent_organization_id into parent_id from public.organizations where id=p_org;
 if parent_id is null then return private.standalone_billing_access(p_org,p_tryout); end if;
 access:=private.standalone_billing_access(parent_id,null);
 if access->>'plan'='organization' and coalesce((access->'features'->>'organization_management')::boolean,false) then
   return access || jsonb_build_object('organizationId',p_org,'tryoutId',p_tryout);
 end if;
 return jsonb_build_object('organizationId',p_org,'tryoutId',p_tryout,'plan','free','source','free',
  'evaluatedAt',now(),'expiresAt',null,'features',jsonb_build_object('create_tryout',true,'basic_evaluations',true),
  'limits',jsonb_build_object('active_tryouts',null,'athletes_per_tryout',null,'evaluators_per_tryout',null,'custom_templates',null));
end $$;

create function private.guard_team_workspace() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and new.parent_organization_id is distinct from old.parent_organization_id then
  raise exception 'workspace_parent_immutable' using errcode='42501';
 end if;
 if new.parent_organization_id is not null and TG_OP='INSERT' then
  perform 1 from public.organizations where id=new.parent_organization_id and parent_organization_id is null for update;
  if not found or not public.is_active_organization_member(new.parent_organization_id,array['owner','administrator']) then
   raise exception 'forbidden' using errcode='42501';
  end if;
  -- Explicit entitlement, even when payment processing is not activated.
  if not coalesce((private.effective_billing_access(new.parent_organization_id)->'features'->>'organization_management')::boolean,false) then
   raise exception 'organization_plan_required' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
create trigger team_workspace_boundary before insert or update on public.organizations for each row execute function private.guard_team_workspace();

-- Shared settings stay owned by the parent, including changes made after a team is created.
create or replace function private.guard_program_defaults() returns trigger
language plpgsql security definer set search_path='' as $$
declare parent public.organizations%rowtype;
begin
 if new.parent_organization_id is not null then
  select * into parent from public.organizations where id=new.parent_organization_id;
  if TG_OP='UPDATE' and (new.terminology,new.sport_defaults,new.tag_defaults) is distinct from (parent.terminology,parent.sport_defaults,parent.tag_defaults) then
   raise exception 'defaults_managed_by_organization' using errcode='42501';
  end if;
  new.terminology:=parent.terminology;new.sport_defaults:=parent.sport_defaults;new.tag_defaults:=parent.tag_defaults;
  return new;
 end if;
 if TG_OP='INSERT' then
  if private.billing_access_enabled() and (new.terminology <> '{"athlete":"Athlete","athletes":"Athletes"}'::jsonb or new.sport_defaults <> '[]'::jsonb or new.tag_defaults <> '[]'::jsonb) then
   raise exception 'entitlement_required' using errcode='42501';
  end if;
 elsif (new.terminology,new.sport_defaults,new.tag_defaults) is distinct from (old.terminology,old.sport_defaults,old.tag_defaults) then
  perform private.require_billing_feature(new.id,null,'organization_management');
 end if;
 return new;
end $$;
create function private.sync_team_defaults() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.parent_organization_id is null and (new.terminology,new.sport_defaults,new.tag_defaults) is distinct from (old.terminology,old.sport_defaults,old.tag_defaults) then
  update public.organizations set terminology=new.terminology,sport_defaults=new.sport_defaults,tag_defaults=new.tag_defaults where parent_organization_id=new.id;
 end if; return new;
end $$;
create trigger sync_team_defaults after update on public.organizations for each row execute function private.sync_team_defaults();

-- Inherited authority cannot be edited in a team, and parent offboarding takes effect in every team.
create function private.guard_inherited_team_membership() returns trigger
language plpgsql security definer set search_path='' as $$
declare parent_id uuid; m public.organization_members%rowtype;
begin
 select parent_organization_id into parent_id from public.organizations where id=coalesce(new.organization_id,old.organization_id);
 if TG_OP='DELETE' then
  if old.inherited_from_organization_id is not null then raise exception 'membership_managed_by_organization' using errcode='42501'; end if;
  return old;
 end if;
 if TG_OP='UPDATE' and old.inherited_from_organization_id is not null and new.inherited_from_organization_id is distinct from old.inherited_from_organization_id then
  raise exception 'membership_managed_by_organization' using errcode='42501';
 end if;
 if new.inherited_from_organization_id is not null then
  select * into m from public.organization_members where organization_id=parent_id and user_id=new.user_id;
  if new.inherited_from_organization_id is distinct from parent_id or m.id is null or
    new.role <> (case when m.role in ('owner','administrator') then m.role else 'member' end) or
    new.status <> (case when m.status='active' and m.role in ('owner','administrator') then 'active' else 'disabled' end) then
   raise exception 'membership_managed_by_organization' using errcode='42501';
  end if;
 elsif parent_id is not null and new.role='owner' then
  raise exception 'ownership_managed_by_organization' using errcode='42501';
 end if;
 return new;
end $$;
create trigger inherited_team_membership before insert or update or delete on public.organization_members for each row execute function private.guard_inherited_team_membership();

create function private.sync_team_administrators() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.inherited_from_organization_id is not null then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended('workspace-membership:'||new.organization_id::text,0));
 insert into public.organization_members(organization_id,user_id,role,status,inherited_from_organization_id)
 select c.id,new.user_id,case when new.role in ('owner','administrator') then new.role else 'member' end,
  case when new.status='active' and new.role in ('owner','administrator') then 'active' else 'disabled' end,new.organization_id
 from public.organizations c where c.parent_organization_id=new.organization_id
 and (new.role in ('owner','administrator') or exists(select 1 from public.organization_members m where m.organization_id=c.id and m.user_id=new.user_id and m.inherited_from_organization_id=new.organization_id))
 on conflict(organization_id,user_id) do update set role=excluded.role,status=excluded.status,inherited_from_organization_id=excluded.inherited_from_organization_id,version=public.organization_members.version+1;
 return new;
end $$;
create trigger sync_team_administrators after insert or update on public.organization_members for each row execute function private.sync_team_administrators();

create function public.create_team_workspace(p_organization_id uuid,p_name text,p_slug text) returns uuid
language plpgsql security definer set search_path='' as $$
declare parent public.organizations%rowtype; child_id uuid;
begin
 select * into parent from public.organizations where id=p_organization_id and parent_organization_id is null for update;
 if not found or not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then raise exception 'forbidden' using errcode='42501'; end if;
 if not coalesce((private.effective_billing_access(p_organization_id)->'features'->>'organization_management')::boolean,false) then raise exception 'organization_plan_required' using errcode='42501'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 160 or p_slug is null or not public.is_valid_organization_slug(p_slug) then raise exception 'invalid_team_workspace' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('workspace-membership:'||p_organization_id::text,0));
 -- An exact retry is safe; existing unrelated workspaces can never be attached.
 select id into child_id from public.organizations where slug=p_slug and parent_organization_id=p_organization_id and name=trim(p_name);
 if child_id is not null then return child_id; end if;
 insert into public.organizations(name,slug,timezone,parent_organization_id) values(trim(p_name),p_slug,parent.timezone,p_organization_id) returning id into child_id;
 insert into public.organization_members(organization_id,user_id,role,status,inherited_from_organization_id)
 select child_id,user_id,role,status,p_organization_id from public.organization_members where organization_id=p_organization_id and status='active' and role in ('owner','administrator');
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
 values(p_organization_id,auth.uid(),'team_workspace.created','organization',child_id,jsonb_build_object('name',trim(p_name)));
 return child_id;
end $$;

-- Teams have one billing owner: the parent. Prevent trial farming, duplicate charges and child overrides.
create function private.guard_team_billing() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.organizations where id=new.organization_id and parent_organization_id is not null) then
  raise exception 'billing_managed_by_organization' using errcode='42501';
 end if;return new;
end $$;
create trigger team_billing_boundary before insert or update on private.billing_purchase_intents for each row execute function private.guard_team_billing();
create trigger team_billing_boundary before insert or update on private.pro_trials for each row execute function private.guard_team_billing();
create trigger team_billing_boundary before insert or update on public.billing_contracts for each row execute function private.guard_team_billing();
create trigger team_billing_boundary before insert or update on public.billing_overrides for each row execute function private.guard_team_billing();
create function private.guard_team_branding() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.organizations where id=coalesce(new.organization_id,old.organization_id) and parent_organization_id is not null) then
  raise exception 'branding_managed_by_organization' using errcode='42501';
 end if;
 if TG_OP='DELETE' then return old; end if;return new;
end $$;
create trigger team_billing_boundary before insert or update on public.subscription_checkout_intents for each row execute function private.guard_team_billing();
create trigger team_branding_boundary before insert or update or delete on private.organization_brand_assets for each row execute function private.guard_team_branding();

create or replace function public.read_organization_logo_service(p_organization_slug text)
returns table(content bytea,content_type text,byte_length integer,sha256 text,updated_at timestamptz)
language sql stable security definer set search_path='' as $$
 select a.content,a.content_type,a.byte_length,a.sha256,a.updated_at
 from public.organizations o join private.organization_brand_assets a on a.organization_id=coalesce(o.parent_organization_id,o.id)
 where o.slug=p_organization_slug and private.billing_feature_available(o.id,null,'custom_branding');
$$;
do $$ declare source text; begin
 select pg_get_functiondef('public.get_organization_logo_metadata(uuid)'::regprocedure) into source;
 if position('asset.organization_id=p_organization_id' in source)=0 then raise exception 'logo_metadata_contract_changed'; end if;
 execute replace(source,'asset.organization_id=p_organization_id','asset.organization_id=(select coalesce(parent_organization_id,id) from public.organizations where id=p_organization_id)');
 select pg_get_functiondef('public.public_registration_tryout_v2(text)'::regprocedure) into source;
 if position('on asset.organization_id=target.organization_id' in source)=0 then raise exception 'registration_brand_contract_changed'; end if;
 execute replace(source,'on asset.organization_id=target.organization_id','on asset.organization_id=coalesce(organization.parent_organization_id,organization.id)');
 -- Parent administrators can manage team coaches; team coaches still cannot alter their own or inherited authority.
 select pg_get_functiondef('public.change_organization_member(uuid,uuid,text,text,bigint,uuid)'::regprocedure) into source;
 if position('actor.role=''administrator'' and (target.role<>''member'' or p_role<>''member'')' in source)=0 then raise exception 'membership_contract_changed'; end if;
 execute replace(source,'actor.role=''administrator'' and (target.role<>''member'' or p_role<>''member'')',
 'actor.role=''administrator'' and not private.is_parent_workspace_manager(p_organization_id) and (target.role<>''member'' or p_role<>''member'')');
 -- Do not offer child trials or a second checkout in the billing API.
 select pg_get_functiondef('private.pro_trial_state(uuid)'::regprocedure) into source;
 execute replace(source,'''eligible'',', '''eligible'', not exists(select 1 from public.organizations where id=p_org and parent_organization_id is not null) and');
 select pg_get_functiondef('public.get_billing_dashboard(uuid)'::regprocedure) into source;
 execute replace(source,'''purchasesEnabled'',(select enabled from private.billing_configuration)',
 '''purchasesEnabled'',(select enabled from private.billing_configuration) and not exists(select 1 from public.organizations where id=p_organization_id and parent_organization_id is not null)');
end $$;

create function public.get_workspace_navigation(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_org public.organizations%rowtype; root_id uuid;
begin
 if not public.is_active_organization_member(p_organization_id) then raise exception 'forbidden' using errcode='42501'; end if;
 select * into current_org from public.organizations where id=p_organization_id;
 root_id:=coalesce(current_org.parent_organization_id,current_org.id);
 return jsonb_build_object(
  'isTeam',current_org.parent_organization_id is not null,
  'parent',case when current_org.parent_organization_id is not null then
   (select jsonb_build_object('id',id,'name',name,'slug',slug,'canManage',public.is_active_organization_member(id,array['owner','administrator'])) from public.organizations where id=root_id) else null end,
  'workspaces',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'slug',o.slug,'isTeam',o.parent_organization_id is not null) order by o.parent_organization_id nulls first,o.name,o.id)
    from public.organizations o join public.organization_members m on m.organization_id=o.id and m.user_id=auth.uid() and m.status='active'
    where o.id=root_id or o.parent_organization_id=root_id),'[]'::jsonb));
end $$;

create function public.list_team_workspaces(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_organization_member(p_organization_id,array['owner','administrator']) or
 not exists(select 1 from public.organizations where id=p_organization_id and parent_organization_id is null) then raise exception 'forbidden' using errcode='42501'; end if;
 if not coalesce((private.effective_billing_access(p_organization_id)->'features'->>'organization_reporting')::boolean,false) then raise exception 'organization_plan_required' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'slug',o.slug,
  'tryouts',(select count(*) from public.tryouts where organization_id=o.id),
  'athletes',(select count(*) from public.athletes where organization_id=o.id),
  'completedEvaluations',(select count(*) from public.evaluations e where e.organization_id=o.id and e.state in ('completed','locked')),
  'coaches',(select count(*) from public.organization_members where organization_id=o.id and role='administrator' and status='active' and inherited_from_organization_id is null)
 ) order by o.name,o.id) from public.organizations o where o.parent_organization_id=p_organization_id),'[]'::jsonb);
end $$;

-- New functions are allowlisted explicitly. Internal helpers must never be RPCs.
revoke all on function private.is_parent_workspace_manager(uuid),private.standalone_billing_access(uuid,uuid),private.guard_team_workspace(),private.sync_team_defaults(),private.guard_inherited_team_membership(),private.sync_team_administrators(),private.guard_team_billing(),private.guard_team_branding() from public,anon,authenticated,service_role;
revoke all on function public.create_team_workspace(uuid,text,text),public.get_workspace_navigation(uuid),public.list_team_workspaces(uuid) from public,anon,service_role;
grant execute on function public.create_team_workspace(uuid,text,text),public.get_workspace_navigation(uuid),public.list_team_workspaces(uuid) to authenticated;
