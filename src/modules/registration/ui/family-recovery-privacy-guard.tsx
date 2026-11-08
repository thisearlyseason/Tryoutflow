'use client';
import { useEffect } from 'react';
import { RECOVERY_RESET } from '@/modules/tryouts/ui/setup-recovery-store';
import {
  clearFamilyRecovery,
  invalidateFamilyTab,
  reconcileFamilyTab,
  FAMILY_EPOCH,
} from './family-recovery-store';
export function FamilyRecoveryPrivacyGuard() {
  useEffect(() => {
    const storage = (event: StorageEvent) => {
      if (event.key === FAMILY_EPOCH || event.key === null) invalidateFamilyTab();
    };
    const restore = () => reconcileFamilyTab();
    restore();
    window.addEventListener('pageshow', restore);
    document.addEventListener('visibilitychange', restore);
    window.addEventListener(RECOVERY_RESET, clearFamilyRecovery);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('pageshow', restore);
      document.removeEventListener('visibilitychange', restore);
      window.removeEventListener(RECOVERY_RESET, clearFamilyRecovery);
      window.removeEventListener('storage', storage);
    };
  }, []);
  return null;
}
