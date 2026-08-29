import type { PublicRegistrationRateLimiter } from '../../modules/registration/application/public-registration-rate-limiter';

/**
 * Adapter seam for workers/other server entry points. Public HTTP registration
 * consumes the same durable counter inside the atomic database command.
 */
export class PostgresRegistrationRateLimiter implements PublicRegistrationRateLimiter {
  constructor(private readonly checkRateLimit: (key: string) => Promise<boolean>) {}

  async check(key: string) {
    return (await this.checkRateLimit(key))
      ? { allowed: true as const }
      : { allowed: false as const, retryAfterSeconds: 600 };
  }
}
