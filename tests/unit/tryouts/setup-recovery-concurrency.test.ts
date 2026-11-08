import { beforeEach, it, expect } from 'vitest';
import { installRecoveryLocks } from '../../helpers/recovery-lock';
import {
  claimRecoveryOwner,
  withRecoveryLock,
  clearAllSetupRecovery,
  readRecovery,
  writeRecovery,
  completeRecovery,
  recoveryKey,
  readRecoveryOwner,
} from '@/modules/tryouts/ui/setup-recovery-store';
const scope = { userId: 'a', organizationId: 'org', form: 'new', baseline: 'new' };
const fields = {
  name: 'Event',
  sport: 'Hockey',
  timezone: 'UTC',
  seasonId: '',
  newSeasonName: 'Cycle',
  registrationStartsAt: '',
  registrationEndsAt: '',
};
beforeEach(async () => {
  localStorage.clear();
  installRecoveryLocks();
  await claimRecoveryOwner('a');
});
it('serializes competing tab revisions so only one wins', async () => {
  const first = writeRecovery(localStorage, scope, fields, null);
  if (first.kind !== 'saved') throw Error('failed');
  const results = await Promise.all([
    withRecoveryLock(() =>
      writeRecovery(localStorage, scope, { ...fields, name: 'Tab A' }, first.record.revision),
    ),
    withRecoveryLock(() =>
      writeRecovery(localStorage, scope, { ...fields, name: 'Tab B' }, first.record.revision),
    ),
  ]);
  expect(results.map((r) => r?.kind).sort()).toEqual(['conflict', 'saved']);
});
it('keeps a queued old writer from recreating data after purge and same-user reauthentication', async () => {
  const old = readRecoveryOwner(localStorage)!;
  await clearAllSetupRecovery(old);
  await claimRecoveryOwner('a');
  const result = await withRecoveryLock(() =>
    writeRecovery(localStorage, scope, fields, null, Date.now(), old.epoch),
  );
  expect(result?.kind).toBe('inactive');
  expect(localStorage.getItem(recoveryKey(scope))).toBeNull();
});
it('conditional success cleanup preserves a new same-scope entry even when its revision starts over', async () => {
  const first = writeRecovery(localStorage, scope, fields, null);
  if (first.kind !== 'saved') throw Error('failed');
  localStorage.removeItem(recoveryKey(scope));
  writeRecovery(localStorage, scope, { ...fields, name: 'New copy' }, null);
  await completeRecovery(scope, first.record);
  expect(readRecovery(localStorage, scope)).toMatchObject({
    record: { fields: { name: 'New copy' } },
  });
});
