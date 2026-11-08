import { render, act } from '@testing-library/react';
import { it, expect } from 'vitest';
import { FamilyRecoveryPrivacyGuard } from '@/modules/registration/ui/family-recovery-privacy-guard';
import { RECOVERY_RESET } from '@/modules/tryouts/ui/setup-recovery-store';
import {
  FAMILY_KEY,
  FAMILY_EPOCH,
  familyEpoch,
  writeFamilyRecovery,
} from '@/modules/registration/ui/family-recovery-store';
it('bridges existing authentication/logout reset into family-copy purge and epoch revocation', () => {
  localStorage.clear();
  sessionStorage.clear();
  const epoch = familyEpoch()!;
  writeFamilyRecovery(
    { tryoutSlug: 'camp', formVersionId: 'v1', context: 'public' },
    { givenName: 'Jordan' },
    { epoch },
  );
  sessionStorage.setItem('unrelated', 'keep');
  render(<FamilyRecoveryPrivacyGuard />);
  act(() => window.dispatchEvent(new Event(RECOVERY_RESET)));
  expect(sessionStorage.getItem(FAMILY_KEY)).toBeNull();
  expect(localStorage.getItem(FAMILY_EPOCH)).not.toBe(epoch);
  expect(sessionStorage.getItem('unrelated')).toBe('keep');
});
it('purges the current tab copy on another-tab privacy change even away from the form', () => {
  localStorage.clear();
  sessionStorage.clear();
  const epoch = familyEpoch()!;
  writeFamilyRecovery(
    { tryoutSlug: 'camp', formVersionId: 'v1', context: 'public' },
    { givenName: 'Jordan' },
    { epoch },
  );
  render(<FamilyRecoveryPrivacyGuard />);
  localStorage.setItem(FAMILY_EPOCH, crypto.randomUUID());
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: FAMILY_EPOCH })));
  expect(sessionStorage.getItem(FAMILY_KEY)).toBeNull();
});
it('reconciles an inactive tab copy on mount before delayed storage events', () => {
  localStorage.clear();
  sessionStorage.clear();
  const epoch = familyEpoch()!;
  writeFamilyRecovery(
    { tryoutSlug: 'camp', formVersionId: 'v1', context: 'public' },
    { givenName: 'Jordan' },
    { epoch },
  );
  localStorage.setItem(FAMILY_EPOCH, crypto.randomUUID());
  render(<FamilyRecoveryPrivacyGuard />);
  expect(sessionStorage.getItem(FAMILY_KEY)).toBeNull();
});
it.each(['pageshow', 'visibilitychange'])(
  'reconciles an off-form copy on %s before delayed storage events',
  (eventName) => {
    localStorage.clear();
    sessionStorage.clear();
    const epoch = familyEpoch()!;
    writeFamilyRecovery(
      { tryoutSlug: 'camp', formVersionId: 'v1', context: 'public' },
      { givenName: 'Jordan' },
      { epoch },
    );
    render(<FamilyRecoveryPrivacyGuard />);
    localStorage.setItem(FAMILY_EPOCH, crypto.randomUUID());
    act(() => (eventName === 'pageshow' ? window : document).dispatchEvent(new Event(eventName)));
    expect(sessionStorage.getItem(FAMILY_KEY)).toBeNull();
  },
);
