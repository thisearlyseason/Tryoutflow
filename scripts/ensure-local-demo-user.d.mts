export declare const DEMO_USER: Readonly<{
  email: 'demo.owner@badlands.example.test';
  organizationId: '29000000-0000-4000-8000-000000000001';
  role: 'owner';
}>;

export function assertLocalSupabaseUrl(value: string): URL;
export function requireLocalDemoPassword(environment: Record<string, string | undefined>): string;
export function ensureLocalDemoUser(
  environment?: Record<string, string | undefined>,
): Promise<{ email: string; organizationId: string; userId: string }>;
