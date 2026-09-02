import { randomUUID } from 'node:crypto';

import { z } from 'zod';

export const DETERMINISTIC_TEST_BOT_TOKEN = 'tryoutflow-deterministic-bot-token-v1';

export function createDeterministicTestBotToken() {
  return `${DETERMINISTIC_TEST_BOT_TOKEN}:${randomUUID()}`;
}

export type BotAction =
  | 'sign_in'
  | 'sign_up'
  | 'recovery'
  | 'verification'
  | 'public_registration'
  | 'registration_confirmation'
  | 'registration_reissue';

export type BotProtection = {
  verify(input: {
    token: string;
    action: BotAction;
    remoteAddress?: string;
  }): Promise<{ ok: true } | { ok: false; reason: 'invalid' | 'unavailable' }>;
};

type FetchPort = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

const turnstileResponseSchema = z
  .object({
    success: z.boolean(),
    challenge_ts: z.string().max(80).optional(),
    hostname: z.string().max(253).optional(),
    action: z.string().max(64).optional(),
    cdata: z.string().max(255).optional(),
    'error-codes': z.array(z.string().max(100)).max(20).optional(),
  })
  .passthrough();

function normalizeHostname(value: string) {
  return value.trim().toLowerCase().replace(/\.+$/u, '');
}

function validRemoteAddress(value: string | undefined) {
  return value && value.length <= 128 && !/[\u0000-\u001f\u007f,|]/u.test(value)
    ? value
    : undefined;
}

export class TurnstileBotProtection implements BotProtection {
  private readonly allowedHostnames: ReadonlySet<string>;
  private readonly now: () => number;
  private readonly request: FetchPort;
  private readonly secretKey: string;
  private readonly timeoutMs: number;

  constructor(input: {
    secretKey: string;
    allowedHostnames: readonly string[];
    request?: FetchPort;
    now?: () => number;
    timeoutMs?: number;
  }) {
    if (input.secretKey.length < 10 || input.secretKey.length > 512)
      throw new Error('Turnstile secret is invalid');
    const hostnames = input.allowedHostnames.map(normalizeHostname).filter(Boolean);
    if (
      hostnames.length === 0 ||
      hostnames.some(
        (hostname) =>
          !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
            hostname,
          ),
      )
    )
      throw new Error('Turnstile hostname allowlist is invalid');
    this.allowedHostnames = new Set(hostnames);
    this.secretKey = input.secretKey;
    this.request = input.request ?? fetch;
    this.now = input.now ?? Date.now;
    this.timeoutMs = input.timeoutMs ?? 3_000;
  }

  async verify(input: {
    token: string;
    action: BotAction;
    remoteAddress?: string;
  }): Promise<{ ok: true } | { ok: false; reason: 'invalid' | 'unavailable' }> {
    if (
      input.token.length < 1 ||
      input.token.length > 2_048 ||
      /[\u0000-\u001f\u007f]/u.test(input.token)
    )
      return { ok: false, reason: 'invalid' };
    const body = new URLSearchParams({
      secret: this.secretKey,
      response: input.token,
      idempotency_key: randomUUID(),
    });
    const remoteAddress = validRemoteAddress(input.remoteAddress);
    if (remoteAddress) body.set('remoteip', remoteAddress);

    try {
      const response = await this.request(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
      if (!response.ok) return { ok: false, reason: 'unavailable' };
      const raw = await response.text();
      if (raw.length > 8_192) return { ok: false, reason: 'unavailable' };
      const parsed = turnstileResponseSchema.safeParse(JSON.parse(raw) as unknown);
      if (!parsed.success) return { ok: false, reason: 'unavailable' };
      const result = parsed.data;
      const challengeAt = result.challenge_ts ? Date.parse(result.challenge_ts) : Number.NaN;
      const age = this.now() - challengeAt;
      if (
        !result.success ||
        !result.hostname ||
        !this.allowedHostnames.has(normalizeHostname(result.hostname)) ||
        result.action !== input.action ||
        !Number.isFinite(challengeAt) ||
        age < -30_000 ||
        age > 300_000
      )
        return { ok: false, reason: 'invalid' };
      return { ok: true };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  }
}

class DeterministicTestBotProtection implements BotProtection {
  async verify(input: { token: string; action: BotAction }) {
    return input.token === DETERMINISTIC_TEST_BOT_TOKEN ||
      input.token.startsWith(`${DETERMINISTIC_TEST_BOT_TOKEN}:`)
      ? ({ ok: true } as const)
      : ({ ok: false, reason: 'invalid' } as const);
  }
}

export function isExactDeterministicBotTestEnvironment(
  environment: Record<string, string | undefined>,
) {
  if (
    environment.NODE_ENV === 'development' &&
    environment.NEXT_PUBLIC_TRYOUTFLOW_LOCAL_DEMO_MODE === 'true' &&
    environment.NEXT_PUBLIC_APP_URL === 'http://localhost:3112' &&
    /^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/u.test(
      environment.NEXT_PUBLIC_SUPABASE_URL ?? '',
    )
  )
    return true;
  if (environment.TRYOUTFLOW_BOT_PROTECTION_MODE !== 'deterministic-test') return false;
  if (environment.NODE_ENV === 'test' && environment.TRYOUTFLOW_SERVER_TEST_ENV === 'vitest')
    return true;
  if (
    environment.NODE_ENV === 'production' &&
    environment.TRYOUTFLOW_SERVER_TEST_ENV === 'task30-playwright' &&
    environment.NEXT_PUBLIC_APP_URL === 'https://task30.e2e.example.test' &&
    /^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/u.test(
      environment.NEXT_PUBLIC_SUPABASE_URL ?? '',
    )
  )
    return true;
  return false;
}

export function createBotProtectionFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
  request?: FetchPort,
): BotProtection {
  if (isExactDeterministicBotTestEnvironment(environment))
    return new DeterministicTestBotProtection();
  const secretKey = environment.TURNSTILE_SECRET_KEY;
  const allowedHostnames = environment.TURNSTILE_ALLOWED_HOSTNAMES?.split(',') ?? [];
  if (!secretKey || allowedHostnames.length === 0)
    throw new Error('Turnstile protection is not configured');
  return new TurnstileBotProtection({ secretKey, allowedHostnames, request });
}
