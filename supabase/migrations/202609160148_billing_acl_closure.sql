-- Match the repository's RPC-only service-role convention.
revoke all on public.billing_products,public.billing_contracts,public.billing_events,public.billing_overrides,public.billing_audit_log from service_role;
