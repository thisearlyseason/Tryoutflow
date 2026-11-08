'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import {
  clearAllSetupRecovery,
  notifyRecoveryReset,
  RECOVERY_OWNER,
  lastRecoveryOwner,
} from './setup-recovery-store';

export function SetupRecoveryPrivacyGuard() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === '/sign-in' || pathname === '/sign-up')
      void clearAllSetupRecovery(lastRecoveryOwner());
  }, [pathname]);
  useEffect(() => {
    const submit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const action = new URL(form.action, location.origin);
      if (action.origin === location.origin && action.pathname === '/auth/sign-out') {
        event.preventDefault();
        void clearAllSetupRecovery().then(() => HTMLFormElement.prototype.submit.call(form));
      }
    };
    const storage = (event: StorageEvent) => {
      if (event.key === RECOVERY_OWNER && event.oldValue !== event.newValue) notifyRecoveryReset();
    };
    document.addEventListener('submit', submit, true);
    window.addEventListener('storage', storage);
    return () => {
      document.removeEventListener('submit', submit, true);
      window.removeEventListener('storage', storage);
    };
  }, []);
  return null;
}
