import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../../src/infrastructure/supabase/database.types';
import type { OrganizationId } from '../../../src/lib/ids';
import { loadOrganizationLogoUrl } from '../../../src/modules/organizations/application/current-organization';

const organization = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId,
  slug: 'badlands',
};

function client(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient<Database>;
}

describe('current organization branding projection', () => {
  it('fails closed when byte-free logo metadata is malformed or unavailable', async () => {
    const malformed = vi.fn().mockResolvedValue({
      data: [
        {
          logo_exists: true,
          sha256: 'a'.repeat(64),
          updated_at: 'private-version-value',
        },
      ],
      error: null,
    });
    const unavailable = vi.fn().mockRejectedValue(new Error('membership database unavailable'));

    await expect(loadOrganizationLogoUrl(client(malformed), organization)).resolves.toBeUndefined();
    await expect(
      loadOrganizationLogoUrl(client(unavailable), organization),
    ).resolves.toBeUndefined();
  });
});
