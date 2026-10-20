-- Reassert the current setup command entrypoint on installations where an older
-- wizard function was restored after the versioned configuration migration.
-- Delegate to the existing versioned implementation; never rewrite saved evaluations.
create or replace function public.save_tryout_wizard_configuration(p_organization_id uuid,p_tryout_id uuid,p_step text,p_payload jsonb)
returns table(outcome text) language plpgsql security definer set search_path='' as $$
declare saved_outcome text;
begin
  if not public.can_manage_tryout_root(p_organization_id,p_tryout_id) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_step is null or p_step not in ('basics','divisions','sessions','registration','rubrics') then
    return query select 'invalid_input'::text; return;
  end if;
  insert into private.tryout_configuration_commands(transaction_id,backend_pid,organization_id,tryout_id,actor_user_id,step)
  values(pg_current_xact_id(),pg_backend_pid(),p_organization_id,p_tryout_id,auth.uid(),p_step);
  -- A failed input rolls back the entire command, including any already inserted children.
  begin
    select result.outcome into saved_outcome from private.save_tryout_setup_configuration(p_organization_id,p_tryout_id,p_step,p_payload) result;
  exception when invalid_text_representation or numeric_value_out_of_range or check_violation or unique_violation or foreign_key_violation then
    saved_outcome:='invalid_input';
  end;
  delete from private.tryout_configuration_commands where transaction_id=pg_current_xact_id()
    and backend_pid=pg_backend_pid() and organization_id=p_organization_id and tryout_id=p_tryout_id;
  return query select saved_outcome;
end;
$$;
revoke all on function public.save_tryout_wizard_configuration(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_tryout_wizard_configuration(uuid,uuid,text,jsonb) to authenticated;
