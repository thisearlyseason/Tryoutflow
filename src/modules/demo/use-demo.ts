'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createDemo,
  DEMO_STORAGE_KEY,
  demoExpired,
  readDemo,
  updateDemo,
  type DemoAction,
  type DemoState,
} from './demo-state';

export function useDemo() {
  const [state, setState] = useState<DemoState | null>(null);
  const [now, setNow] = useState(0);
  const [notice, setNotice] = useState('');
  const [persistent, setPersistent] = useState(true);
  const current = useRef<DemoState | null>(null);

  function save(next: DemoState) {
    current.current = next;
    setState(next);
    try {
      localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(next));
    } catch {
      setPersistent(false);
    }
  }

  useEffect(() => {
    const time = Date.now();
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(DEMO_STORAGE_KEY);
    } catch {
      setPersistent(false);
    }
    save(readDemo(raw, time));
    setNow(time);
    function tick() {
      const time = Date.now();
      setNow(time);
      if (current.current && demoExpired(current.current, time)) {
        save(createDemo(time));
        setNotice('Your 30-minute demo has reset. The original sample tryout is ready again.');
      }
    }
    function sync(event: StorageEvent) {
      if (event.key !== DEMO_STORAGE_KEY && event.key !== null) return;
      const next = readDemo(event.newValue, Date.now());
      if (current.current && next.startedAt !== current.current.startedAt)
        setNotice('The demo has reset. The original sample tryout is ready again.');
      current.current = next;
      setState(next);
      setNow(Date.now());
    }
    const timer = setInterval(tick, 1000);
    window.addEventListener('storage', sync);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  function change(action: DemoAction) {
    if (!current.current) return;
    const time = Date.now();
    const expired = demoExpired(current.current, time);
    const next = updateDemo(current.current, action, time);
    save(next);
    setNow(time);
    setNotice(
      expired ? 'Your demo has reset. Please try that action again.' : 'Saved in your demo.',
    );
  }
  function reset() {
    const time = Date.now();
    save(createDemo(time));
    setNow(time);
    setNotice('Demo reset. Your original sample tryout is ready again.');
  }
  return { state, now, notice, persistent, change, reset };
}
