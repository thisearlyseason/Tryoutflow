import { z } from 'zod';

const clientEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const serverEnvironmentSchema = clientEnvironmentSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export type ClientEnvironment = z.infer<typeof clientEnvironmentSchema>;
export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

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
