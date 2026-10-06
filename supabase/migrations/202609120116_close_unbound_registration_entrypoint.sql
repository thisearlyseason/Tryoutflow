-- Apply only after the application has promoted its version-bound submit RPC.
-- The owner-executed inner call remains available to the new atomic wrapper.
revoke all on function public.submit_public_registration_with_notification(text,jsonb,text,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.create_staff_registration(uuid,uuid,uuid,uuid,uuid,text,text,date,jsonb,text)
  from public,anon,authenticated,service_role;
