import { createHash, createHmac } from 'node:crypto';

export const task30RateLimitSecret = 'task30-local-rate-limit-secret'.padEnd(64, 'r');
export const task30AbuseProtectionSecret = 'task30-abuse-protection-secret'.padEnd(64, 'a');
export const task30AuthBrowserAddress = 'task30-local-browser';

export type Task30AbuseScope = 'auth_sign_in' | 'public_registration';
export type Task30BotAction = 'sign_in' | 'public_registration';
export type Task30AbuseAttempt = Readonly<{
  scope: Task30AbuseScope;
  action: Task30BotAction;
  subject: string;
  address: string;
  token: string;
}>;
export type Task30AbuseRateKey = Readonly<{
  scope: Task30AbuseScope;
  subjectDigest: string;
  addressDigest: string;
}>;
export type Task30BotReceiptKey = Readonly<{
  action: Task30BotAction;
  tokenDigest: string;
}>;

export function task30AbuseRecord(attempt: Task30AbuseAttempt) {
  const hmac = (label: string, value: string) =>
    createHmac('sha256', task30AbuseProtectionSecret)
      .update(`${label}\u0000${value}`)
      .digest('hex');
  return {
    rate: {
      scope: attempt.scope,
      subjectDigest: hmac(
        `subject:${attempt.scope}`,
        attempt.subject.trim().toLocaleLowerCase('en-US'),
      ),
      addressDigest: hmac(`address:${attempt.scope}`, attempt.address),
    },
    bot: {
      action: attempt.action,
      tokenDigest: createHash('sha256').update(attempt.token).digest('hex'),
    },
  } as const;
}

export function task30BrowserAddress(key: string) {
  const host =
    (Number.parseInt(createHash('sha256').update(key).digest('hex').slice(0, 2), 16) % 254) + 1;
  return `192.0.2.${host}`;
}

export type Task30PublicRateBucket = 'registration' | 'confirmation' | 'reissue' | 'consume';

export function task30PublicRequestRateKeys(
  key: string,
  bucket: Task30PublicRateBucket,
  target: string,
) {
  const address = task30BrowserAddress(key);
  const digest = (value: string) =>
    createHmac('sha256', task30RateLimitSecret).update(value).digest('hex');
  return [
    digest(`${bucket}|context|${address}`),
    digest(`${bucket}|target|${target}|${address}`),
  ] as const;
}

export function task30RegistrationRateKeys(key: string, tryoutSlug: string) {
  const [context, target] = task30PublicRequestRateKeys(key, 'registration', tryoutSlug);
  return [
    context,
    target,
    createHash('sha256').update(`registration-transaction|${target}`).digest('hex'),
  ] as const;
}
