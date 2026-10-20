-- Apply after the application uses submit_public_registration_with_notification.
-- Keep the inner operation callable only by the definer so service callers
-- cannot bypass the atomic notification guarantee.
revoke all on function public.submit_public_registration_v2(text,jsonb,text,text)
from public,anon,authenticated,service_role;
