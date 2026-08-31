import { createHash, createHmac } from 'node:crypto';

export const task30RateLimitSecret = 'task30-local-rate-limit-secret'.padEnd(64, 'r');

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
