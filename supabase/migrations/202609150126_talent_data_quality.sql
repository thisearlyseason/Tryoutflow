alter table public.performance_metrics add constraint ratio_unit check(value_kind<>'ratio' or unit='%');
alter table public.performance_metrics add constraint meaningful_best check(aggregation<>'best' or direction<>'neutral');
alter table public.scouting_records add constraint video_without_credentials check(video_url is null or (video_url !~ '^https://[^/]*@' and video_url !~ '[[:space:]]'));
-- Use contract errors for a zero denominator instead of a divide-by-zero database failure.
create or replace function public.performance_result_guard() returns trigger language plpgsql set search_path='' as $$
declare m public.performance_metrics%rowtype;begin
 select * into strict m from public.performance_metrics where organization_id=new.organization_id and id=new.metric_id;
 if new.status='valid' then
  if m.value_kind='ratio' then
   if new.numerator is null or new.denominator is null or new.denominator<=0 or new.numerator<0 or new.numerator>new.denominator then raise exception 'ratio requires valid attempts and successes' using errcode='23514'; end if;
   new.value:=round(new.numerator/new.denominator*100,6);
  elsif new.numerator is not null or new.denominator is not null then raise exception 'only ratio uses numerator' using errcode='23514'; end if;
  if (m.value_kind='count' and new.value<>trunc(new.value)) or (m.minimum is not null and new.value<m.minimum) or (m.maximum is not null and new.value>m.maximum) then raise exception 'measurement outside metric contract' using errcode='23514'; end if;
 end if;
 if new.measured_at>clock_timestamp()+interval '5 minutes' then raise exception 'measurement cannot be in the future' using errcode='23514'; end if;return new;
end;$$;
