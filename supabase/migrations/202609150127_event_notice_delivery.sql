create function public.preview_event_notice(p_organization_id uuid,p_notice_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare n public.event_notices%rowtype;projection jsonb;begin
 if not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then raise exception 'organizer required' using errcode='42501'; end if;
 select * into strict n from public.event_notices where organization_id=p_organization_id and id=p_notice_id;
 projection:=jsonb_build_object('notice_id',n.id,'version',n.version,'title',n.title,'body',n.body,'status',n.status,'recipients',(
 select coalesce(jsonb_agg(jsonb_build_object('registration_id',r.id,'guardian_id',g.id,'name',g.name,'email',g.email,'eligible',l.communication_permitted and coalesce(p.optional_email_enabled,true)) order by r.id,g.id),'[]')
 from public.tryout_registrations r join public.athlete_guardians l on l.organization_id=r.organization_id and l.athlete_id=r.athlete_id join public.guardians g on g.organization_id=l.organization_id and g.id=l.guardian_id left join public.notification_preferences p on p.organization_id=g.organization_id and p.guardian_id=g.id where r.organization_id=p_organization_id and r.tryout_id=n.tryout_id and r.status='submitted'));
 return projection||jsonb_build_object('digest',encode(extensions.digest(projection::text,'sha256'),'hex'));
end;$$;
create function public.queue_event_notice(p_organization_id uuid,p_notice_id uuid,p_expected_digest text) returns jsonb language plpgsql security definer set search_path='' as $$
declare preview jsonb;r jsonb;receipt public.queue_communication_result;queued integer:=0;suppressed integer:=0;replayed integer:=0;begin
 if not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then raise exception 'organizer required' using errcode='42501'; end if;
 perform 1 from public.event_notices where organization_id=p_organization_id and id=p_notice_id for share;
 preview:=public.preview_event_notice(p_organization_id,p_notice_id);
 if preview->>'digest' is distinct from p_expected_digest or preview->>'status'<>'published' then raise exception 'preview changed or notice not published' using errcode='40001'; end if;
 if jsonb_array_length(preview->'recipients')>1000 then raise exception 'narrow recipient scope before sending' using errcode='23514'; end if;
 for r in select value from jsonb_array_elements(preview->'recipients') loop
  select * into receipt from public.queue_registration_communication_v2(p_organization_id,(r->>'registration_id')::uuid,(r->>'guardian_id')::uuid,'registration_reminder',preview->>'title',preview->>'body','event-notice:'||p_notice_id||':'||(preview->>'version')||':'||(r->>'registration_id')||':'||(r->>'guardian_id'));
  if receipt.outcome='queued' then queued:=queued+1;elsif receipt.outcome='replayed' then replayed:=replayed+1;elsif receipt.outcome='suppressed' then suppressed:=suppressed+1;else raise exception 'recipient changed; refresh preview' using errcode='40001';end if;
 end loop;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id) values(p_organization_id,auth.uid(),'event.notice.queued','event_notice',p_notice_id);
 return jsonb_build_object('queued',queued,'replayed',replayed,'suppressed',suppressed);
end;$$;
revoke all on function public.preview_event_notice(uuid,uuid),public.queue_event_notice(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.preview_event_notice(uuid,uuid),public.queue_event_notice(uuid,uuid,text) to authenticated;
