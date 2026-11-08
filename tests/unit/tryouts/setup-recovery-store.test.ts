import { installRecoveryLocks } from '../../helpers/recovery-lock';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  RECOVERY_PREFIX,
  RECOVERY_OWNER,
  RECOVERY_TTL,
  recoveryKey,
  readRecovery,
  writeRecovery,
  claimRecoveryOwner,
  clearAllSetupRecovery,
  clearRecoveryRecord,
} from '@/modules/tryouts/ui/setup-recovery-store';
const scope = { userId: 'user-a', organizationId: 'org-a', form: 'new', baseline: 'new' };
const fields = {
  name: 'Fall event',
  sport: 'Hockey',
  timezone: 'UTC',
  seasonId: 'cycle',
  newSeasonName: '',
  registrationStartsAt: '',
  registrationEndsAt: '',
};
const now = 1_800_000_000_000;
beforeEach(async () => {
  installRecoveryLocks();
  localStorage.clear();
  vi.restoreAllMocks();
  await claimRecoveryOwner(scope.userId);
});
describe('trusted-device setup recovery', () => {
  it('stores nothing until explicitly written and never serializes extra fields', () => {
    expect(readRecovery(localStorage, scope, now).kind).toBe('none');
    const result = writeRecovery(
      localStorage,
      scope,
      {
        ...fields,
        password: 'secret',
        confirmation: 'CONSENT',
        guardianEmail: 'private@example.test',
      },
      null,
      now,
    );
    expect(result.kind).toBe('saved');
    const raw = localStorage.getItem(recoveryKey(scope))!;
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('CONSENT');
    expect(raw).not.toContain('guardianEmail');
    expect(readRecovery(localStorage, scope, now)).toMatchObject({
      kind: 'candidate',
      record: { fields },
    });
  });
  it('has a fixed24hour expiry and removes expired copies', () => {
    const first = writeRecovery(localStorage, scope, fields, null, now);
    if (first.kind !== 'saved') throw Error('save failed');
    const next = writeRecovery(
      localStorage,
      scope,
      { ...fields, name: 'Changed' },
      first.record.revision,
      now + 1000,
    );
    expect(next).toMatchObject({ kind: 'saved', record: { expiresAt: now + RECOVERY_TTL } });
    expect(readRecovery(localStorage, scope, now + RECOVERY_TTL).kind).toBe('expired');
    expect(localStorage.getItem(recoveryKey(scope))).toBeNull();
  });
  it('never reads another owner/organization/form and purges on account switch', async () => {
    writeRecovery(localStorage, scope, fields, null, now);
    expect(readRecovery(localStorage, { ...scope, userId: 'user-b' }, now).kind).toBe('none');
    expect(readRecovery(localStorage, { ...scope, organizationId: 'org-b' }, now).kind).toBe(
      'none',
    );
    await claimRecoveryOwner('user-b');
    expect(localStorage.getItem(recoveryKey(scope))).toBeNull();
    expect(JSON.parse(localStorage.getItem(RECOVERY_OWNER)!).userId).toBe('user-b');
  });
  it('blocks a stale Basics baseline and drops cycle fields from Basics storage', () => {
    const basics = { ...scope, form: 'basics:event', baseline: '3' };
    writeRecovery(localStorage, basics, fields, null, now);
    expect(readRecovery(localStorage, { ...basics, baseline: '4' }, now).kind).toBe('stale');
    const raw = localStorage.getItem(recoveryKey(basics))!;
    expect(raw).not.toContain('seasonId');
  });
  it('does not overwrite a newer tab revision', () => {
    const first = writeRecovery(localStorage, scope, fields, null, now);
    if (first.kind !== 'saved') throw Error('save failed');
    const second = writeRecovery(
      localStorage,
      scope,
      { ...fields, name: 'Other tab' },
      first.record.revision,
      now + 1,
    );
    expect(second.kind).toBe('saved');
    expect(
      writeRecovery(
        localStorage,
        scope,
        { ...fields, name: 'Stale tab' },
        first.record.revision,
        now + 2,
      ).kind,
    ).toBe('conflict');
    expect(readRecovery(localStorage, scope, now + 2)).toMatchObject({
      record: { fields: { name: 'Other tab' } },
    });
  });
  it.each(['not-json', 'x'.repeat(11000)])('removes corrupt or oversized copies', (raw) => {
    localStorage.setItem(recoveryKey(scope), raw);
    expect(readRecovery(localStorage, scope, now).kind).toBe('none');
    expect(localStorage.getItem(recoveryKey(scope))).toBeNull();
  });
  it('rejects injected fields and wrong scope in otherwise shaped data', () => {
    const first = writeRecovery(localStorage, scope, fields, null, now);
    if (first.kind !== 'saved') throw Error('save failed');
    localStorage.setItem(
      recoveryKey(scope),
      JSON.stringify({ ...first.record, fields: { ...fields, password: 'secret' } }),
    );
    expect(readRecovery(localStorage, scope, now).kind).toBe('none');
  });
  it('clears only recovery data and cannot recreate copies after logout', async () => {
    localStorage.setItem('unrelated.preference', 'keep');
    writeRecovery(localStorage, scope, fields, null, now);
    await clearAllSetupRecovery();
    expect(localStorage.getItem('unrelated.preference')).toBe('keep');
    expect(localStorage.getItem(RECOVERY_OWNER)).toBeNull();
    expect(writeRecovery(localStorage, scope, fields, null, now + 1).kind).toBe('inactive');
    expect(
      [...Array(localStorage.length)].some((_, i) =>
        localStorage.key(i)?.startsWith(RECOVERY_PREFIX),
      ),
    ).toBe(false);
  });
  it('handles storage denial without changing ordinary form authority', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw Error('blocked');
    });
    expect(readRecovery(localStorage, scope, now).kind).toBe('unavailable');
    expect(writeRecovery(localStorage, scope, fields, null, now).kind).toBe('unavailable');
    expect(() => clearRecoveryRecord(localStorage, scope)).not.toThrow();
  });
});

it('does not let an old account cleanup erase a newer verified owner copy', async () => {
  await claimRecoveryOwner('user-b');
  const other = { ...scope, userId: 'user-b' };
  writeRecovery(localStorage, other, fields, null, now);
  await clearAllSetupRecovery('user-a');
  expect(localStorage.getItem(recoveryKey(other))).not.toBeNull();
  expect(JSON.parse(localStorage.getItem(RECOVERY_OWNER)!).userId).toBe('user-b');
});
