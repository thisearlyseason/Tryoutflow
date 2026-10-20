# Environment operations

TryoutFlow uses separate Vercel and Supabase projects for development, preview, and production. Never connect a preview deployment to production Supabase, Stripe, Resend, or cron credentials. Preview data must be synthetic.

## Required configuration

Start from `.env.example`; keep values in the deployment platform, not Git. Validate each environment by running `npm run build` with its intended variables before release.

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: browser-safe values for that environment's Supabase project.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only. It is limited to narrow webhook/job paths and must never use a `NEXT_PUBLIC_` name.
- `NEXT_PUBLIC_APP_URL`: the canonical origin. Production accepts only a publicly routable HTTPS origin with no path, query, fragment, or credentials.
- `PUBLIC_REGISTRATION_RATE_LIMIT_SECRET`: server-only, random, at least 32 characters, and different in every environment.
- `ABUSE_PROTECTION_HMAC_SECRET`: server-only, random, at least 32 characters, and different in every environment. It HMACs normalized auth/registration subjects and trusted edge addresses before the shared database limiter stores them; rotate it deliberately because rotation starts new rate buckets.
- Cloudflare Turnstile: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is the browser widget key; `TURNSTILE_SECRET_KEY` is server-only; `TURNSTILE_ALLOWED_HOSTNAMES` is a comma-separated exact hostname allowlist with no schemes, ports, or paths. Sign-in, account creation, recovery, verification resend, public registration submission, registration confirmation, and confirmation reissue fail closed if the server configuration or Siteverify response is unavailable, stale, malformed, for another hostname, or for another action.
- `EVALUATION_SNAPSHOT_PROOF_PRIVATE_JWK` and `NEXT_PUBLIC_EVALUATION_SNAPSHOT_PROOF_PUBLIC_JWK`: one matching P-256 pair. Only the public half may enter a browser bundle.
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the three `STRIPE_PRICE_*` mappings. Preview uses Stripe test mode; production uses live values only after the release gates below.
- Resend: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `RESEND_WEBHOOK_SECRET`.
- `JOB_PROCESSOR_CRON_SECRET`: server-only bearer secret, 32–512 characters, used by `POST /api/jobs/process`.
- `ENABLE_MOCK_THE_SQUAD_PROVIDER`: keep `false` in production. The mock adapter is a labelled demo boundary, not a live integration.

The deterministic bot adapter is compiled into an exact automated-test boundary only. It is not a development or production fallback. Configure a Turnstile development site/secret and explicit local hostname when manually exercising protected forms; never reuse production secrets locally.

## Supabase Auth account verification

First-owner creation uses public Supabase email/password signup and requires verified email before `/start` can create an organization. Configure each hosted Supabase Auth project manually before release:

1. Enable email/password signup and require email confirmation. Do not enable anonymous-user or automatic athlete/guardian account creation.
2. Set the Site URL to the exact `NEXT_PUBLIC_APP_URL` origin and allow only the exact `/auth/callback` redirect origins needed for that environment. Remove localhost and preview origins from production.
3. Configure a production SMTP sender, verified sending domain, confirmation template, expiry/rate limits, and delivery/bounce ownership. Local Mailpit evidence proves the controlled test boundary only; it is not evidence of hosted delivery.
4. Exercise new-address and already-existing-address requests through the same generic confirmation state, then prove that only a confirmed session reaches `/start`. Do not place an email address or provider error in logs, analytics, or support tickets.

## Platform access bootstrap

Platform authority is stored in `public.platform_administrators`, not JWT metadata. It has RLS and no client or service-role table privileges. Bootstrap or disable an administrator only through a reviewed operator SQL session as the database owner:

```sql
begin;
insert into public.platform_administrators(user_id,granted_by_user_id)
values ('<existing-auth-user-uuid>','<approving-existing-auth-user-uuid>');
commit;
```

For the first bootstrap only, the approving ID may be the same existing auth user. Record the change ticket outside the database. To remove current authority without erasing the durable row:

```sql
update public.platform_administrators
set status='disabled',disabled_at=clock_timestamp()
where user_id='<auth-user-uuid>' and status='active';
```

Support access is never bootstrapped in SQL. A current platform administrator uses `/platform/support`; the database creates a self-only, 5-minute-to-4-hour elevation and append-only organization audit event atomically. Elevation does not impersonate an organization member.

## External production release gates

Do not onboard real organizations until all are signed off:

1. A paid, non-pausing production Supabase plan, production-region decision, backups, and a tested restore procedure.
2. Vercel production domain/TLS, environment separation, cron schedule, and secret rotation owner.
3. Stripe live account, products/prices, webhook endpoint/signature verification, tax/legal review, and a test-mode-to-live checklist.
4. Resend verified sending domain, SPF/DKIM/DMARC, webhook signature, suppression/bounce handling, and support ownership.
5. Legal/privacy review for minor-athlete data and each applicable Canadian/customer jurisdiction; approved retention, deletion, correction, export, and breach procedures.
6. Turnstile production site/secret/hostname configuration, shared HMAC-secret ownership, and a hosted staging exercise for every protected action. The repository does not call a live bot provider during its release gate.
7. Supabase Auth production Site URL/redirect allowlist, mandatory email confirmation, SMTP sender/domain/template delivery, and recovery/verification ownership.
8. Monitoring destinations and alert ownership. The application writes a closed, tenant-scoped analytics event to a durable database outbox after core persistence; production still needs an approved outbox consumer/retention policy and operational alert destination.
9. A documented, authenticated live team-management API. The current The Squad implementation is mock-only and must stay disabled for production transfer.

## Rotation

Rotate a suspected secret immediately in its provider, update only the affected environment, redeploy, and verify the corresponding narrow boundary. Rotate webhook secrets with an overlap window only if the provider supports it. Never paste secret values into logs, audit details, incident tickets, or chat.
