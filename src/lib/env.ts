import { z } from 'zod';

const clientEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const serverEnvironmentSchema = clientEnvironmentSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  PUBLIC_REGISTRATION_RATE_LIMIT_SECRET: z.string().min(32),
});

export type ClientEnvironment = z.infer<typeof clientEnvironmentSchema>;
export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

const communicationEnvironmentSchema = z.object({
  JOB_PROCESSOR_CRON_SECRET: z.string().min(32).max(512),
  RESEND_API_KEY: z.string().min(20).max(300),
  RESEND_FROM_EMAIL: z.email().max(320),
});
export type CommunicationEnvironment = z.infer<typeof communicationEnvironmentSchema>;

/** Validates the single canonical origin used in externally shared links. */
export function getPublicAppOrigin(
  environment: Record<string, string | undefined> = process.env,
): string {
  const raw = z.string().url().parse(environment.NEXT_PUBLIC_APP_URL);
  const url = new URL(raw);
  const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const production = environment.NODE_ENV === 'production';
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('NEXT_PUBLIC_APP_URL must be an origin without a path, query, or fragment');
  }
  if (production && (url.protocol !== 'https:' || localHost)) {
    throw new Error('Production public app origin must be a secure non-localhost HTTPS origin');
  }
  if (url.protocol !== 'https:' && !localHost) {
    throw new Error('Public app origin must be secure unless it is explicit localhost');
  }
  return url.origin;
}

export function getClientEnvironment(
  environment: Record<string, string | undefined> = process.env,
): ClientEnvironment {
  return clientEnvironmentSchema.parse(environment);
}

export function getServerEnvironment(
  environment: Record<string, string | undefined> = process.env,
): ServerEnvironment {
  if (typeof window !== 'undefined') {
    throw new Error('Server environment cannot be read in the browser');
  }

  return serverEnvironmentSchema.parse(environment);
}

export function getCommunicationEnvironment(
  environment: Record<string, string | undefined> = process.env,
): CommunicationEnvironment {
  if (typeof window !== 'undefined')
    throw new Error('Server environment cannot be read in the browser');
  return communicationEnvironmentSchema.parse(environment);
}
