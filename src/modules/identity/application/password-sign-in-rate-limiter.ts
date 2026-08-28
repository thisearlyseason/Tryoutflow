import { createHash } from 'node:crypto';

export type SignInRequestContext = {
  networkAddress?: string;
};

export type PasswordSignInAttempt = {
  email: string;
  botVerificationToken?: string;
  requestContext?: SignInRequestContext;
};

export type PasswordSignInAbuseProtection = {
  check(
    attempt: PasswordSignInAttempt,
  ): Promise<
    { allowed: true } | { allowed: false; reason: 'rate_limited' | 'bot_verification_required' }
  >;
};

export type PasswordSignInRateLimiterOptions = {
  maxAttempts?: number;
  maxEntries?: number;
  now?: () => number;
  windowMs?: number;
};

type RateLimitRecord = {
  attempts: number;
  expiresAt: number;
  touchedAt: number;
};

const defaultMaxAttempts = 5;
const defaultMaxEntries = 10_000;
const defaultWindowMs = 15 * 60 * 1000;

function rateLimitKey(attempt: PasswordSignInAttempt): string {
  const normalizedEmail = attempt.email.trim().toLocaleLowerCase('en-US');
  const networkAddress = attempt.requestContext?.networkAddress ?? 'no-trusted-network-context';

  return createHash('sha256')
    .update(`tryoutflow-password-sign-in\u0000${normalizedEmail}\u0000${networkAddress}`)
    .digest('base64url');
}

function trustedNetworkAddress(value: string | null): string | undefined {
  if (!value || value.length > 128 || /[\u0000-\u001F\u007F]/.test(value)) {
    return undefined;
  }

  return value.split(',')[0]?.trim() || undefined;
}

/**
 * Vercel sets this header at its trusted edge. User-controlled forwarded headers
 * are intentionally ignored so local callers cannot select their limiter key.
 */
export function getTrustedSignInRequestContext(headers: Headers): SignInRequestContext {
  return {
    networkAddress: trustedNetworkAddress(headers.get('x-vercel-forwarded-for')),
  };
}

/**
 * Process-local defense in depth for password guessing. It is deliberately
 * bounded and expires entries, but is not a globally distributed limiter.
 */
export function createPasswordSignInRateLimiter(
  options: PasswordSignInRateLimiterOptions = {},
): PasswordSignInAbuseProtection & { entryCount(): number } {
  const maxAttempts = options.maxAttempts ?? defaultMaxAttempts;
  const maxEntries = options.maxEntries ?? defaultMaxEntries;
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? defaultWindowMs;
  const records = new Map<string, RateLimitRecord>();

  function pruneExpired(currentTime: number) {
    records.forEach((record, key) => {
      if (record.expiresAt <= currentTime) {
        records.delete(key);
      }
    });
  }

  function removeOldestRecord() {
    let oldestKey: string | undefined;
    let oldestTouchedAt = Number.POSITIVE_INFINITY;

    records.forEach((record, key) => {
      if (record.touchedAt < oldestTouchedAt) {
        oldestKey = key;
        oldestTouchedAt = record.touchedAt;
      }
    });

    if (oldestKey) {
      records.delete(oldestKey);
    }
  }

  return {
    async check(attempt) {
      const currentTime = now();
      pruneExpired(currentTime);
      const key = rateLimitKey(attempt);
      const record = records.get(key);

      if (record) {
        if (record.attempts >= maxAttempts) {
          return { allowed: false, reason: 'rate_limited' };
        }

        record.attempts += 1;
        record.touchedAt = currentTime;
        return { allowed: true };
      }

      if (records.size >= maxEntries) {
        removeOldestRecord();
      }

      records.set(key, {
        attempts: 1,
        expiresAt: currentTime + windowMs,
        touchedAt: currentTime,
      });
      return { allowed: true };
    },
    entryCount() {
      pruneExpired(now());
      return records.size;
    },
  };
}

let defaultPasswordSignInRateLimiter = createPasswordSignInRateLimiter();

export function getDefaultPasswordSignInAbuseProtection(): PasswordSignInAbuseProtection {
  return defaultPasswordSignInRateLimiter;
}

export function resetDefaultPasswordSignInAbuseProtectionForTests() {
  defaultPasswordSignInRateLimiter = createPasswordSignInRateLimiter();
}
