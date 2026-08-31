create function private.tryout_wizard_instant(p_value text,p_timezone text)
returns timestamptz
language plpgsql stable security invoker set search_path='' as $$
declare local_value timestamp without time zone; instant timestamptz; rendered text;
begin
  if p_value is null or p_timezone is null
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone)
  then return null; end if;
  if p_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]+)?)?([zZ]|[+-][0-9]{2}:[0-9]{2})$'
  then return p_value::timestamptz; end if;
  if p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?$'
  then return null; end if;
  local_value:=p_value::timestamp without time zone;
  instant:=local_value at time zone p_timezone;
  rendered:=to_char(instant at time zone p_timezone,
    case when char_length(p_value)=16 then 'YYYY-MM-DD"T"HH24:MI' else 'YYYY-MM-DD"T"HH24:MI:SS' end);
  return case when rendered=p_value then instant else null end;
exception when others then return null;
end;
$$;

revoke all on function private.tryout_wizard_instant(text,text) from public,anon,authenticated,service_role;

alter function public.save_tryout_wizard_configuration(uuid,uuid,text,jsonb)
  rename to save_tryout_wizard_configuration_v088;
revoke all on function public.save_tryout_wizard_configuration_v088(uuid,uuid,text,jsonb)
  from public,anon,authenticated,service_role;

create function public.save_tryout_wizard_configuration(
  p_organization_id uuid,p_tryout_id uuid,p_step text,p_payload jsonb
)
returns table(outcome text)
language plpgsql security definer set search_path='' as $$
declare normalized jsonb:=p_payload; timezone_name text; starts_at timestamptz; ends_at timestamptz;
begin
  if p_step='basics' then
    timezone_name:=trim(p_payload->>'timezone');
    starts_at:=private.tryout_wizard_instant(p_payload->>'registrationStartsAt',timezone_name);
    ends_at:=private.tryout_wizard_instant(p_payload->>'registrationEndsAt',timezone_name);
    if starts_at is null or ends_at is null or ends_at<=starts_at then
      return query select 'invalid_input'::text; return;
    end if;
    normalized:=jsonb_set(
      jsonb_set(normalized,'{registrationStartsAt}',to_jsonb(to_char(starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))),
      '{registrationEndsAt}',to_jsonb(to_char(ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    );
  elsif p_step='sessions' then
    select tryout.timezone into timezone_name
    from public.tryouts tryout
    where tryout.organization_id=p_organization_id and tryout.id=p_tryout_id;
    starts_at:=private.tryout_wizard_instant(p_payload->>'startsAt',timezone_name);
    ends_at:=private.tryout_wizard_instant(p_payload->>'endsAt',timezone_name);
    if starts_at is null or ends_at is null or ends_at<=starts_at then
      return query select 'invalid_input'::text; return;
    end if;
    normalized:=jsonb_set(
      jsonb_set(normalized,'{startsAt}',to_jsonb(to_char(starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))),
      '{endsAt}',to_jsonb(to_char(ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    );
  end if;
  return query select * from public.save_tryout_wizard_configuration_v088(
    p_organization_id,p_tryout_id,p_step,normalized
  );
end;
$$;

revoke all on function public.save_tryout_wizard_configuration(uuid,uuid,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.save_tryout_wizard_configuration(uuid,uuid,text,jsonb)
  to authenticated;
