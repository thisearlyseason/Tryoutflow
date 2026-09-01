import { createHash, createHmac } from 'node:crypto';

import { createAdminSupabaseClient } from '../../../infrastructure/supabase/admin';
import {
  createBotProtectionFromEnvironment,
  type BotAction,
  type BotProtection,
} from './bot-protection';

export type AuthAbuseScope =
  | 'auth_sign_in'
  | 'auth_sign_up'
  | 'auth_recovery'
  | 'auth_verification'
  | 'public_registration'
  | 'registration_confirmation'
  | 'registration_reissue';

export type AuthRequestContext = { networkAddress?: string };

export type AuthAbuseAttempt = {
  scope: AuthAbuseScope;
  action: BotAction;
  subject: string;
  token: string;
  requestContext?: AuthRequestContext;
};

export type AuthAbuseDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'rate_limited' | 'bot_verification_required' | 'abuse_protection_unavailable';
    };

export type AuthAbuseProtection = {
  check(attempt: AuthAbuseAttempt): Promise<AuthAbuseDecision>;
};

type RpcPort = (
  name: 'consume_abuse_rate_limit' | 'consume_bot_token_once',
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;

const scopeActions: Record<AuthAbuseScope, BotAction> = {
  auth_sign_in: 'sign_in',
  auth_sign_up: 'sign_up',
  auth_recovery: 'recovery',
  auth_verification: 'verification',
  public_registration: 'public_registration',
  registration_confirmation: 'registration_confirmation',
  registration_reissue: 'registration_reissue',
};

const defaultLimits: Record<AuthAbuseScope, { limit: number; windowSeconds: number }> = {
  auth_sign_in: { limit: 5, windowSeconds: 900 },
  auth_sign_up: { limit: 4, windowSeconds: 900 },
  auth_recovery: { limit: 4, windowSeconds: 900 },
  auth_verification: { limit: 4, windowSeconds: 900 },
  public_registration: { limit: 10, windowSeconds: 900 },
  registration_confirmation: { limit: 10, windowSeconds: 900 },
  registration_reissue: { limit: 4, windowSeconds: 900 },
};

function trustedNetworkAddress(value: string | null): string | undefined {
  if (!value || value.length > 128 || /[\u0000-\u001f\u007f,|]/u.test(value)) return undefined;
  const address = value.trim();
  return address || undefined;
}

/** Only a deployment-controlled edge header may choose an abuse-limiter address. */
export function getTrustedAuthRequestContext(headers: Headers): AuthRequestContext {
  return {
    networkAddress: trustedNetworkAddress(headers.get('x-vercel-forwarded-for')),
  };
}

function singleRow(data: unknown): Record<string, unknown> | undefined {
  return Array.isArray(data) && data.length === 1 && data[0] && typeof data[0] === 'object'
    ? (data[0] as Record<string, unknown>)
    : undefined;
}

export function createDatabaseAuthAbuseProtection(input: {
  rpc: RpcPort;
  botProtection: BotProtection;
  hmacSecret: string;
  limits?: Partial<Record<AuthAbuseScope, { limit: number; windowSeconds: number }>>;
}): AuthAbuseProtection {
  if (input.hmacSecret.length < 32) throw new Error('Abuse-protection HMAC secret is invalid');
  const limits = { ...defaultLimits, ...input.limits };
  const hmac = (label: string, value: string) =>
    createHmac('sha256', input.hmacSecret).update(`${label}\u0000${value}`).digest('hex');

  return {
    async check(attempt) {
      const normalizedSubject = attempt.subject.trim().toLocaleLowerCase('en-US');
      const address = attempt.requestContext?.networkAddress;
      if (
        scopeActions[attempt.scope] !== attempt.action ||
        normalizedSubject.length < 1 ||
        normalizedSubject.length > 320 ||
        /[\u0000-\u001f\u007f]/u.test(normalizedSubject) ||
        !address ||
        address.length > 128 ||
        attempt.token.length < 1 ||
        attempt.token.length > 2_048
      )
        return { allowed: false, reason: 'abuse_protection_unavailable' };
      try {
        const limit = limits[attempt.scope];
        const rate = await input.rpc('consume_abuse_rate_limit', {
          p_subject_digest: hmac(`subject:${attempt.scope}`, normalizedSubject),
          p_address_digest: hmac(`address:${attempt.scope}`, address),
          p_scope: attempt.scope,
          p_limit: limit.limit,
          p_window_seconds: limit.windowSeconds,
        });
        const rateRow = singleRow(rate.data);
        if (rate.error || typeof rateRow?.allowed !== 'boolean')
          return { allowed: false, reason: 'abuse_protection_unavailable' };
        if (!rateRow.allowed) return { allowed: false, reason: 'rate_limited' };

        const bot = await input.botProtection.verify({
          token: attempt.token,
          action: attempt.action,
          remoteAddress: address,
        });
        if (!bot.ok)
          return {
            allowed: false,
            reason:
              bot.reason === 'invalid'
                ? 'bot_verification_required'
                : 'abuse_protection_unavailable',
          };
        const receipt = await input.rpc('consume_bot_token_once', {
          p_token_digest: createHash('sha256').update(attempt.token).digest('hex'),
          p_action: attempt.action,
          p_ttl_seconds: 300,
        });
        const receiptRow = singleRow(receipt.data);
        if (receipt.error || typeof receiptRow?.consumed !== 'boolean')
          return { allowed: false, reason: 'abuse_protection_unavailable' };
        return receiptRow.consumed
          ? { allowed: true }
          : { allowed: false, reason: 'bot_verification_required' };
      } catch {
        return { allowed: false, reason: 'abuse_protection_unavailable' };
      }
    },
  };
}

export function getDefaultAuthAbuseProtection(
  environment: Record<string, string | undefined> = process.env,
): AuthAbuseProtection {
  const hmacSecret = environment.ABUSE_PROTECTION_HMAC_SECRET;
  if (!hmacSecret) throw new Error('Abuse protection is not configured');
  const client = createAdminSupabaseClient();
  return createDatabaseAuthAbuseProtection({
    rpc: (name, args) =>
      client.rpc(name, args as never) as unknown as PromiseLike<{
        data: unknown;
        error: unknown;
      }>,
    botProtection: createBotProtectionFromEnvironment(environment),
    hmacSecret,
  });
}
