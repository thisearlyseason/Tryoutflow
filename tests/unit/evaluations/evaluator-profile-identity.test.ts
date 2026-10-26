import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  'src/app/(app)/app/[organizationSlug]/evaluate/session/[sessionId]/athletes/[registrationId]/page.tsx',
  'utf8',
);

describe('production evaluator profile identity binding', () => {
  it('includes the authenticated actor and organization UUID with the resource identity', () => {
    const expression = route.match(
      /const profileIdentity = JSON\.stringify\(\[([\s\S]*?)\]\);/,
    )?.[1];
    expect(expression).toBeDefined();
    for (const field of [
      'userId',
      'organizationId',
      'sessionId',
      'registrationId',
      'rubricVersionId',
    ]) {
      expect(expression).toContain(`storageScope.${field}`);
    }
    expect(route).toContain('userId: loaded.value.current.userId');
    expect(route).toContain('organizationId: loaded.value.current.organization.id');
  });
  it('uses that same principal-scoped identity for remount and asynchronous peer response isolation', () => {
    expect(route).toContain('key={profileIdentity}');
    expect(route).toContain('profileScope={profileIdentity}');
  });
});
