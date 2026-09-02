import { describe, expect, it } from 'vitest';

import {
  assertLocalSupabaseUrl,
  DEMO_USER,
  requireLocalDemoPassword,
} from '../../../scripts/ensure-local-demo-user.mjs';
import { createLocalDemoEnvironment } from '../../../scripts/start-local-demo.mjs';

describe('local demo identity bootstrap', () => {
  it('accepts only loopback Supabase origins before provisioning', () => {
    expect(assertLocalSupabaseUrl('http://127.0.0.1:54321').hostname).toBe('127.0.0.1');
    expect(assertLocalSupabaseUrl('http://localhost:54321').hostname).toBe('localhost');
    expect(() => assertLocalSupabaseUrl('https://project.supabase.co')).toThrow(
      'local Supabase only',
    );
    expect(() => assertLocalSupabaseUrl('http://192.0.2.10:54321')).toThrow('local Supabase only');
  });

  it('binds one synthetic owner to the deterministic Badlands organization', () => {
    expect(DEMO_USER).toEqual({
      email: 'demo.owner@badlands.example.test',
      organizationId: '29000000-0000-4000-8000-000000000001',
      role: 'owner',
    });
  });

  it('requires an untracked password instead of embedding a default', () => {
    expect(() => requireLocalDemoPassword({})).toThrow('TRYOUTFLOW_LOCAL_DEMO_PASSWORD');
    expect(
      requireLocalDemoPassword({ TRYOUTFLOW_LOCAL_DEMO_PASSWORD: 'TryoutFlowDemo!2026' }),
    ).toBe('TryoutFlowDemo!2026');
  });

  it('builds the local demo runtime only for the canonical loopback app and Supabase origins', () => {
    expect(
      createLocalDemoEnvironment(
        {
          apiUrl: 'http://127.0.0.1:54321',
          publishableKey: 'local-publishable-key',
          serviceRoleKey: 'local-service-role-key',
        },
        {},
      ),
    ).toMatchObject({
      NEXT_PUBLIC_TRYOUTFLOW_LOCAL_DEMO_MODE: 'true',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3112',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'local-publishable-key',
      SUPABASE_SERVICE_ROLE_KEY: 'local-service-role-key',
    });

    expect(() =>
      createLocalDemoEnvironment(
        {
          apiUrl: 'https://project.supabase.co',
          publishableKey: 'local-publishable-key',
          serviceRoleKey: 'local-service-role-key',
        },
        {},
      ),
    ).toThrow('local Supabase only');
    expect(() =>
      createLocalDemoEnvironment(
        {
          apiUrl: 'http://[::1]:54321',
          publishableKey: 'local-publishable-key',
          serviceRoleKey: 'local-service-role-key',
        },
        {},
      ),
    ).toThrow('127.0.0.1 or localhost');
    expect(() =>
      createLocalDemoEnvironment(
        {
          apiUrl: 'http://127.0.0.1:54321',
          publishableKey: 'local-publishable-key',
          serviceRoleKey: 'local-service-role-key',
        },
        { NEXT_PUBLIC_APP_URL: 'https://tryoutflow.example' },
      ),
    ).toThrow('localhost:3112');
  });
});
