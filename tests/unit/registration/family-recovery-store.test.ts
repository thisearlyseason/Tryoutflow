import { beforeEach, it, expect } from 'vitest';
import {
  FAMILY_KEY,
  FAMILY_EPOCH,
  FAMILY_TTL,
  familyEpoch,
  readFamilyRecovery,
  writeFamilyRecovery,
  clearFamilyRecovery,
  completeFamilyRecovery,
} from '@/modules/registration/ui/family-recovery-store';
const scope = { tryoutSlug: 'camp', formVersionId: 'version1', context: 'public' };
const values = {
  givenName: 'Jordan',
  familyName: 'Lee',
  guardianName: 'Alex',
  guardianEmail: 'alex@example.test',
  guardianPhone: '555-0100',
  divisionId: 'd1',
  positionId: 'p1',
};
const now = 1800000000000;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
function save(fields = values) {
  const result = writeFamilyRecovery(scope, fields, { epoch: familyEpoch()! }, now);
  if (result.kind !== 'saved') throw Error('not saved');
  return result.record;
}
it('keeps no values by default and explicitly writes only allowed tab-session details', () => {
  expect(readFamilyRecovery(scope, now).kind).toBe('none');
  expect(sessionStorage.getItem(FAMILY_KEY)).toBeNull();
  save({
    ...values,
    birthDate: '2012-01-01',
    waiver: 'on',
    medical: 'PRIVATE',
    botVerificationToken: 'SECRET',
  } as typeof values);
  const raw = sessionStorage.getItem(FAMILY_KEY)!;
  expect(raw).not.toContain('PRIVATE');
  expect(raw).not.toContain('SECRET');
  expect(raw).not.toContain('birthDate');
  expect(raw).not.toContain('waiver');
  expect(localStorage.length).toBe(1);
  expect(localStorage.getItem(FAMILY_EPOCH)).not.toContain('Jordan');
  expect(readFamilyRecovery(scope, now)).toMatchObject({
    kind: 'candidate',
    record: { fields: values },
  });
});
it('has a fixed30minute TTL and stops expired writes', () => {
  const first = save();
  const next = writeFamilyRecovery(
    scope,
    { ...values, givenName: 'Edit' },
    { epoch: first.epoch, id: first.id, revision: first.revision },
    now + 1000,
  );
  expect(next).toMatchObject({ kind: 'saved', record: { expiresAt: now + FAMILY_TTL } });
  expect(readFamilyRecovery(scope, now + FAMILY_TTL).kind).toBe('expired');
  expect(sessionStorage.getItem(FAMILY_KEY)).toBeNull();
  expect(
    writeFamilyRecovery(
      scope,
      values,
      { epoch: first.epoch, id: first.id, revision: first.revision },
      now + FAMILY_TTL,
    ).kind,
  ).not.toBe('saved');
});
it('blocks changed versions and drops another event or linked-athlete context', () => {
  save();
  expect(readFamilyRecovery({ ...scope, formVersionId: 'version2' }, now).kind).toBe('stale');
  expect(readFamilyRecovery({ ...scope, context: 'linked:other' }, now).kind).toBe('none');
  expect(sessionStorage.getItem(FAMILY_KEY)).toBeNull();
  save();
  expect(readFamilyRecovery({ ...scope, tryoutSlug: 'other' }, now).kind).toBe('none');
});
it('rejects injected/oversized data and malformed records', () => {
  const first = save();
  sessionStorage.setItem(
    FAMILY_KEY,
    JSON.stringify({ ...first, fields: { ...values, waiver: true } }),
  );
  expect(readFamilyRecovery(scope, now).kind).toBe('none');
  expect(
    writeFamilyRecovery(
      scope,
      { ...values, givenName: 'x'.repeat(161) },
      { epoch: familyEpoch()! },
      now,
    ).kind,
  ).toBe('unavailable');
  sessionStorage.setItem(FAMILY_KEY, 'x'.repeat(6000));
  expect(readFamilyRecovery(scope, now).kind).toBe('none');
});
it('invalidates copied tabs/stale writers on privacy epoch change and preserves unrelated storage', () => {
  const first = save();
  const raw = sessionStorage.getItem(FAMILY_KEY)!;
  sessionStorage.setItem('unrelated', 'keep');
  clearFamilyRecovery();
  expect(sessionStorage.getItem('unrelated')).toBe('keep');
  sessionStorage.setItem(FAMILY_KEY, raw);
  expect(readFamilyRecovery(scope, now).kind).toBe('none');
  expect(writeFamilyRecovery(scope, values, { epoch: first.epoch }, now).kind).toBe('inactive');
});
it('confirmed cleanup cannot erase a newer revision or another registration context', () => {
  const first = save();
  const second = writeFamilyRecovery(
    scope,
    { ...values, givenName: 'Newer' },
    { epoch: first.epoch, id: first.id, revision: first.revision },
    now + 1,
  );
  expect(second.kind).toBe('saved');
  completeFamilyRecovery(scope, first);
  expect(sessionStorage.getItem(FAMILY_KEY)).not.toBeNull();
  readFamilyRecovery({ ...scope, tryoutSlug: 'other' }, now);
  const other = writeFamilyRecovery(
    { ...scope, tryoutSlug: 'other' },
    values,
    { epoch: familyEpoch()! },
    now,
  );
  expect(other.kind).toBe('saved');
  completeFamilyRecovery(scope, first);
  expect(sessionStorage.getItem(FAMILY_KEY)).not.toBeNull();
});
