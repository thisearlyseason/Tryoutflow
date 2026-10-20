-- Preserve the immutable client mutation identity while disclosing the exact
-- authoritative evaluation identity for a same-natural-key create conflict.

alter function public.sync_evaluation_mutation(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb)
  rename to sync_evaluation_mutation_legacy;

revoke all on function public.sync_evaluation_mutation_legacy(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb)
  from public,anon,authenticated,service_role;

create function public.sync_evaluation_mutation(
  p_organization_id uuid,p_tryout_id uuid,p_session_id uuid,p_registration_id uuid,
  p_rubric_version_id uuid,p_evaluation_id uuid,p_client_mutation_id uuid,
  p_expected_version integer,p_draft jsonb
) returns table(receipt jsonb)
language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid();
declare result jsonb;
declare authoritative_id uuid;
begin
  select legacy.receipt into result
  from public.sync_evaluation_mutation_legacy(
    p_organization_id,p_tryout_id,p_session_id,p_registration_id,
    p_rubric_version_id,p_evaluation_id,p_client_mutation_id,p_expected_version,p_draft
  ) legacy;

  if result->>'outcome'='conflict' then
    select e.id into authoritative_id
    from public.evaluations e
    where e.organization_id=p_organization_id
      and e.tryout_id=p_tryout_id
      and e.tryout_registration_id=p_registration_id
      and e.tryout_session_id=p_session_id
      and e.evaluator_user_id=actor_id
      and e.rubric_version_id=p_rubric_version_id
    for share;
    if authoritative_id is not null then
      result:=result||jsonb_build_object('serverEvaluationId',authoritative_id);
      update public.evaluation_mutations m
      set receipt=result
      where m.actor_user_id=actor_id
        and m.client_mutation_id=p_client_mutation_id
        and m.organization_id=p_organization_id
        and m.evaluation_id=p_evaluation_id
        and m.receipt->>'outcome'='conflict';
      select m.receipt into result
      from public.evaluation_mutations m
      where m.actor_user_id=actor_id and m.client_mutation_id=p_client_mutation_id;
    end if;
  end if;
  return query select result;
end;
$$;

revoke all on function public.sync_evaluation_mutation(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb)
  from public,anon,service_role;
grant execute on function public.sync_evaluation_mutation(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb)
  to authenticated;
