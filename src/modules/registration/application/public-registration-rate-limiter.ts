export interface PublicRegistrationRateLimiter {
  check(key: string): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }>;
}
