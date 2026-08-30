// @vitest-environment node

import { createHmac, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

import { handleStripeWebhook as POST } from '../../../src/app/api/webhooks/stripe/route';
import { entitlementsFor } from '../../../src/modules/subscriptions/domain/entitlements';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = (sql: string) =>
  execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql]);
const sqlLiteral = (value: unknown) => {
  if (value === null || value === undefined) return 'null';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `'${text.replaceAll("'", "''")}'`;
};
const rpcClient = {
  async rpc(_name: string, args: Record<string, unknown>) {
    try {
      const result = await psql(`select public.apply_stripe_subscription_event(
        ${sqlLiteral(args.p_event_id)},${sqlLiteral(args.p_event_type)},
        ${sqlLiteral(args.p_provider_created_at)}::timestamptz,${sqlLiteral(args.p_customer_id)},
        ${sqlLiteral(args.p_subscription_id)},${sqlLiteral(args.p_organization_id)}::uuid,
        ${sqlLiteral(args.p_plan_key)},${sqlLiteral(args.p_state)},${sqlLiteral(args.p_payload)}::jsonb,
        ${sqlLiteral(args.p_payload_digest)});`);
      return { data: result.stdout.trim(), error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
};
const ids = {
  owner: randomUUID(),
  otherOwner: randomUUID(),
  organization: randomUUID(),
  other: randomUUID(),
  concurrentA: randomUUID(),
  concurrentB: randomUUID(),
};
const webhookSecret = 'whsec_task24_webhook_secret_1234567890';
const webhookEnvironment = {
  STRIPE_WEBHOOK_SECRET: webhookSecret,
  STRIPE_PRICE_TEAM: 'price_team_task24',
  STRIPE_PRICE_CLUB: 'price_club_task24',
  STRIPE_PRICE_ASSOCIATION: 'price_association_task24',
};
const signedRequest = (body: string, timestamp = Math.floor(Date.now() / 1_000)) => {
  const signature = createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': `t=${timestamp},v1=${signature}`,
    },
    body,
  });
};
const event = (input: {
  id: string;
  created: number;
  organizationId: string;
  customer?: string;
  subscription?: string;
  price?: string;
  status?: string;
  type?: string;
}) =>
  JSON.stringify({
    id: input.id,
    object: 'event',
    created: input.created,
    type: input.type ?? 'customer.subscription.updated',
    data: {
      object: {
        id: input.subscription ?? 'sub_task24canonical',
        object: 'subscription',
        customer: input.customer ?? 'cus_task24canonical',
        status: input.status ?? 'active',
        metadata: { organization_id: input.organizationId },
        items: { data: [{ price: { id: input.price ?? 'price_team_task24' } }] },
      },
    },
  });

afterAll(async () => {
  await psql(`set session_replication_role=replica;
    delete from public.subscription_events where organization_id in('${ids.organization}','${ids.other}','${ids.concurrentA}','${ids.concurrentB}');
    delete from public.organization_members where organization_id in('${ids.organization}','${ids.other}','${ids.concurrentA}','${ids.concurrentB}');
    delete from public.subscription_accounts where organization_id in('${ids.organization}','${ids.other}','${ids.concurrentA}','${ids.concurrentB}');
    delete from public.organizations where id in('${ids.organization}','${ids.other}','${ids.concurrentA}','${ids.concurrentB}');
    delete from auth.users where id in('${ids.owner}','${ids.otherOwner}');
    set session_replication_role=origin;`);
});

describe('verified Stripe subscription authority', () => {
  it('derives fail-closed entitlements from plan and verified state', () => {
    expect(entitlementsFor({ plan: 'trial', state: 'trialing' }).canPublishTryout).toBe(true);
    expect(entitlementsFor({ plan: 'club', state: 'active' }).canPublishTryout).toBe(true);
    expect(entitlementsFor({ plan: 'club', state: 'past_due' }).canPublishTryout).toBe(false);
    expect(entitlementsFor({ plan: 'club', state: 'canceled' }).canPublishTryout).toBe(false);
    expect(entitlementsFor({ plan: null, state: 'active' }).canPublishTryout).toBe(false);
  });

  it('rejects invalid, expired, oversized, and malformed raw-body signatures', async () => {
    const body = event({
      id: 'evt_task24invalid',
      created: Math.floor(Date.now() / 1_000),
      organizationId: ids.organization,
    });
    const invalid = signedRequest(body);
    invalid.headers.set('stripe-signature', 't=1,v1=bad');
    expect((await POST(invalid, { environment: webhookEnvironment })).status).toBe(400);
    expect(
      (
        await POST(signedRequest(body, 1), {
          environment: webhookEnvironment,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(signedRequest('x'.repeat(70_000)), {
          environment: { STRIPE_WEBHOOK_SECRET: webhookSecret },
        })
      ).status,
    ).toBe(413);
  });

  it('returns retryable server status for configuration and database failures', async () => {
    const body = event({
      id: 'evt_task24failure',
      created: Math.floor(Date.now() / 1_000),
      organizationId: ids.organization,
    });
    expect(
      (
        await POST(signedRequest(body), {
          environment: { STRIPE_WEBHOOK_SECRET: webhookSecret },
        })
      ).status,
    ).toBe(500);
    expect(
      (
        await POST(signedRequest(body), {
          environment: {
            STRIPE_WEBHOOK_SECRET: webhookSecret,
            STRIPE_PRICE_TEAM: 'price_team_task24',
            STRIPE_PRICE_CLUB: 'price_club_task24',
            STRIPE_PRICE_ASSOCIATION: 'price_association_task24',
          },
          client: { rpc: async () => ({ data: null, error: new Error('database unavailable') }) },
        })
      ).status,
    ).toBe(500);
  });

  it('applies once, ignores older state, and stores unknown prices without entitlement', async () => {
    await psql(`insert into auth.users(id,email) values('${ids.owner}','${ids.owner}@example.com'),('${ids.otherOwner}','${ids.otherOwner}@example.com');
      insert into public.organizations(id,name,slug) values('${ids.organization}','Task 24 Org','task24-${ids.organization.slice(0, 8)}'),('${ids.other}','Task 24 Other','task24-${ids.other.slice(0, 8)}');
      insert into public.organization_members(organization_id,user_id,role,status) values('${ids.organization}','${ids.owner}','owner','active'),('${ids.other}','${ids.otherOwner}','owner','active');`);
    const now = Math.floor(Date.now() / 1_000);
    const activeBody = event({
      id: 'evt_task24active',
      created: now,
      organizationId: ids.organization,
    });
    const deps = {
      environment: {
        STRIPE_WEBHOOK_SECRET: webhookSecret,
        STRIPE_PRICE_TEAM: 'price_team_task24',
        STRIPE_PRICE_CLUB: 'price_club_task24',
        STRIPE_PRICE_ASSOCIATION: 'price_association_task24',
      },
      client: rpcClient,
    };
    expect(await (await POST(signedRequest(activeBody), deps)).json()).toEqual({
      outcome: 'applied',
    });
    expect(await (await POST(signedRequest(activeBody), deps)).json()).toEqual({
      outcome: 'replayed',
    });

    const older = event({
      id: 'evt_task24older',
      created: now - 10,
      organizationId: ids.organization,
      status: 'canceled',
    });
    expect(await (await POST(signedRequest(older), deps)).json()).toEqual({
      outcome: 'ignored_out_of_order',
    });
    const unknown = event({
      id: 'evt_task24unknown',
      created: now + 10,
      organizationId: ids.other,
      customer: 'cus_task24unknown',
      subscription: 'sub_task24unknown',
      price: 'price_unknownprice',
    });
    expect(await (await POST(signedRequest(unknown), deps)).json()).toEqual({
      outcome: 'unknown_price',
    });
    expect(
      (
        await psql(
          `select plan_key||'|'||state||'|'||entitlement_source from public.subscription_accounts where organization_id='${ids.organization}'`,
        )
      ).stdout.trim(),
    ).toBe('team|active|stripe');
    expect(
      (
        await psql(
          `select coalesce(plan_key,'none')||'|'||state from public.subscription_accounts where organization_id='${ids.other}'`,
        )
      ).stdout.trim(),
    ).toBe('none|canceled');
    expect(
      (
        await psql(
          `select count(*) from public.subscription_events where organization_id in('${ids.organization}','${ids.other}')`,
        )
      ).stdout.trim(),
    ).toBe('3');
  });

  it('denies cross-organization owner billing lookup and conflicting customer mapping', async () => {
    const denied = await psql(
      `set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','${ids.owner}',false); select count(*) from public.get_owned_subscription_account('${ids.other}');`,
    );
    expect(denied.stdout.trim()).toBe('0');
    const now = Math.floor(Date.now() / 1_000) + 20;
    const conflicting = event({
      id: 'evt_task24conflict',
      created: now,
      organizationId: ids.other,
      customer: 'cus_task24canonical',
      subscription: 'sub_task24other',
    });
    const response = await POST(signedRequest(conflicting), {
      environment: {
        STRIPE_WEBHOOK_SECRET: webhookSecret,
        STRIPE_PRICE_TEAM: 'price_team_task24',
        STRIPE_PRICE_CLUB: 'price_club_task24',
        STRIPE_PRICE_ASSOCIATION: 'price_association_task24',
      },
      client: rpcClient,
    });
    expect(await response.json()).toEqual({ outcome: 'customer_conflict' });
    expect(
      (
        await psql(
          `select entitlement_source||'|'||state||'|'||last_provider_event_id from public.subscription_accounts where organization_id='${ids.other}'`,
        )
      ).stdout.trim(),
    ).toBe('stripe|canceled|evt_task24unknown');
  });

  it('serializes concurrent customer claims and monotonic events in PostgreSQL', async () => {
    await psql(`insert into public.organizations(id,name,slug) values
      ('${ids.concurrentA}','Concurrent A','task24-${ids.concurrentA.slice(0, 8)}'),
      ('${ids.concurrentB}','Concurrent B','task24-${ids.concurrentB.slice(0, 8)}');`);
    const apply = (input: {
      eventId: string;
      createdAt: string;
      organizationId: string;
      customer: string;
      subscription: string;
      state: string;
      digest: string;
    }) =>
      psql(`select public.apply_stripe_subscription_event(
        '${input.eventId}','customer.subscription.updated','${input.createdAt}',
        '${input.customer}','${input.subscription}','${input.organizationId}',
        'team','${input.state}','{"concurrent":true}','${input.digest}');`);
    const claims = await Promise.all([
      apply({
        eventId: 'evt_task24claimA',
        createdAt: '2026-08-30T13:00:00Z',
        organizationId: ids.concurrentA,
        customer: 'cus_task24shared',
        subscription: 'sub_task24claima',
        state: 'active',
        digest: 'a'.repeat(64),
      }),
      apply({
        eventId: 'evt_task24claimB',
        createdAt: '2026-08-30T13:00:00Z',
        organizationId: ids.concurrentB,
        customer: 'cus_task24shared',
        subscription: 'sub_task24claimb',
        state: 'active',
        digest: 'b'.repeat(64),
      }),
    ]);
    expect(claims.map((result) => result.stdout.trim()).sort()).toEqual([
      'applied',
      'customer_conflict',
    ]);
    const winner = (
      await psql(
        `select organization_id from public.subscription_accounts where provider_customer_id='cus_task24shared'`,
      )
    ).stdout.trim();
    const subscription = winner === ids.concurrentA ? 'sub_task24claima' : 'sub_task24claimb';
    await Promise.all([
      apply({
        eventId: 'evt_task24newer',
        createdAt: '2026-08-30T13:02:00Z',
        organizationId: winner,
        customer: 'cus_task24shared',
        subscription,
        state: 'active',
        digest: 'c'.repeat(64),
      }),
      apply({
        eventId: 'evt_task24olderrace',
        createdAt: '2026-08-30T13:01:00Z',
        organizationId: winner,
        customer: 'cus_task24shared',
        subscription,
        state: 'canceled',
        digest: 'd'.repeat(64),
      }),
    ]);
    expect(
      (
        await psql(
          `select state||'|'||last_provider_event_created_at from public.subscription_accounts where organization_id='${winner}'`,
        )
      ).stdout.trim(),
    ).toBe('active|2026-08-30 13:02:00+00');
    const restrictiveTie = await apply({
      eventId: 'evt_task24samecancel',
      createdAt: '2026-08-30T13:02:00Z',
      organizationId: winner,
      customer: 'cus_task24shared',
      subscription,
      state: 'canceled',
      digest: 'e'.repeat(64),
    });
    expect(restrictiveTie.stdout.trim()).toBe('applied');
    const permissiveTie = await apply({
      eventId: 'evt_task24sameactive',
      createdAt: '2026-08-30T13:02:00Z',
      organizationId: winner,
      customer: 'cus_task24shared',
      subscription,
      state: 'active',
      digest: 'f'.repeat(64),
    });
    expect(permissiveTie.stdout.trim()).toBe('ignored_out_of_order');
    expect(
      (
        await psql(
          `select state from public.subscription_accounts where organization_id='${winner}'`,
        )
      ).stdout.trim(),
    ).toBe('canceled');
  });
});
