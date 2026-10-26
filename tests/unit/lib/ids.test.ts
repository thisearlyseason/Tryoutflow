import { describe, expect, it } from 'vitest';

import { parseAuditEntityId, parseOrganizationId } from '../../../src/lib/ids';

describe('parseOrganizationId', () => {
  it('returns a branded UUID for a valid organization identifier', () => {
    const id = '6053b548-2bd8-4c57-9c13-c1381e4d29cc';

    expect(parseOrganizationId(id)).toBe(id);
  });

  it('rejects a malformed organization identifier', () => {
    expect(() => parseOrganizationId('bad-id')).toThrow('Invalid organization ID');
  });
});

describe('parseAuditEntityId', () => {
  it('returns a branded UUID for an audited entity identifier', () => {
    const id = '6053b548-2bd8-4c57-9c13-c1381e4d29cc';

    expect(parseAuditEntityId(id)).toBe(id);
  });

  it('rejects a malformed audited entity identifier', () => {
    expect(() => parseAuditEntityId('not-a-uuid')).toThrow('Invalid audit entity ID');
  });
});
