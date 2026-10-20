-- New trials last seven days. Preserve every existing trial's promised expiry.
alter table private.pro_trials drop constraint pro_trials_check;
alter table private.pro_trials add constraint pro_trials_duration_check
  check (expires_at = starts_at + interval '72 hours'
      or expires_at = starts_at + interval '168 hours');

do $$ declare source text; begin
  select pg_get_functiondef('public.start_pro_trial(uuid)'::regprocedure) into source;
  if position('interval ''72 hours''' in source)=0 then
    raise exception 'pro_trial_duration_contract_changed';
  end if;
  execute replace(source,'interval ''72 hours''','interval ''168 hours''');
end $$;
