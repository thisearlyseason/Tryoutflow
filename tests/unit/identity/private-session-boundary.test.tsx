import { renderToString } from 'react-dom/server';
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PrivateSessionBoundary } from '@/modules/identity/ui/private-session-boundary';

const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSession: vi.fn(),
  replace: vi.fn(),
  unsubscribe: vi.fn(),
  changed: null as null | ((event: string, session: any) => void),
}));
const router = { replace: auth.replace };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/infrastructure/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getUser: auth.getUser,
      getSession: auth.getSession,
      onAuthStateChange: (callback: typeof auth.changed) => {
        auth.changed = callback;
        return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
      },
    },
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue({ data: { user: { id: 'owner-fixture' } }, error: null });
  auth.getSession.mockResolvedValue({
    data: {
      session: { user: { id: 'owner-fixture' }, expires_at: Math.floor(Date.now() / 1000) + 60 },
    },
    error: null,
  });
  history.replaceState(null, '', '/app/club/reports?tryout=fixture');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function open() {
  await act(async () => {
    render(
      <PrivateSessionBoundary userId="owner-fixture">
        <p>Private athlete report</p>
      </PrivateSessionBoundary>,
    );
  });
}
test('a signed-out session removes private content and redirects with the exact private destination', async () => {
  await open();
  expect(screen.getByText('Private athlete report')).toBeTruthy();
  act(() => auth.changed?.('SIGNED_OUT', null));
  expect(screen.queryByText('Private athlete report')).toBeNull();
  expect(auth.replace).toHaveBeenCalledWith(
    '/sign-in?next=%2Fapp%2Fclub%2Freports%3Ftryout%3Dfixture',
  );
  // A full-navigation recovery link remains usable if client routing cannot leave stale UI.
  expect(screen.getByRole('link', { name: /^Sign in$/ })).toHaveAttribute(
    'href',
    '/sign-in?next=%2Fapp%2Fclub%2Freports%3Ftryout%3Dfixture',
  );
});
test('expiry and an account switch hide the previously authorized account content', async () => {
  vi.useFakeTimers();
  await open();
  act(() =>
    auth.changed?.('INITIAL_SESSION', {
      user: { id: 'owner-fixture' },
      expires_at: Math.floor(Date.now() / 1000) + 2,
    }),
  );
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.queryByText('Private athlete report')).toBeNull();
  cleanup();
  await open();
  act(() =>
    auth.changed?.('SIGNED_IN', {
      user: { id: 'other-fixture' },
      expires_at: Math.floor(Date.now() / 1000) + 60,
    }),
  );
  expect(screen.queryByText('Private athlete report')).toBeNull();
});
test('a browser history restore re-verifies authority before showing cached private content', async () => {
  await open();
  let finish!: (value: any) => void;
  auth.getUser.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => window.dispatchEvent(new Event('pageshow')));
  expect(screen.queryByText('Private athlete report')).toBeNull();
  await act(async () => {
    finish({ data: { user: null }, error: null });
  });
  expect(screen.queryByText('Private athlete report')).toBeNull();
  expect(auth.replace).toHaveBeenCalled();
});
test('a stale verification result cannot reopen private content after logout', async () => {
  let finish!: (value: any) => void;
  auth.getUser.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await open();
  act(() => auth.changed?.('SIGNED_OUT', null));
  await act(async () => {
    finish({ data: { user: { id: 'owner-fixture' } }, error: null });
  });
  expect(screen.queryByText('Private athlete report')).toBeNull();
});

test('initial server render never includes private children before verification', () => {
  expect(
    renderToString(
      <PrivateSessionBoundary userId="owner-fixture">
        <p>Private athlete report</p>
      </PrivateSessionBoundary>,
    ),
  ).not.toContain('Private athlete report');
});
test('changed user identity cannot render children under prior verification', async () => {
  const rendered = vi.fn();
  function Secret() {
    rendered();
    return <p>Changed account secret</p>;
  }
  let mounted!: ReturnType<typeof render>;
  await act(async () => {
    mounted = render(
      <PrivateSessionBoundary userId="owner-fixture">
        <p>Original</p>
      </PrivateSessionBoundary>,
    );
  });
  auth.getUser.mockImplementationOnce(() => new Promise(() => {}));
  mounted.rerender(
    <PrivateSessionBoundary userId="other-fixture">
      <Secret />
    </PrivateSessionBoundary>,
  );
  expect(rendered).not.toHaveBeenCalled();
});

test('beforeunload invalidates pending getUser and suppresses departing-document redirects', async () => {
  await open();
  let finish!: (value: any) => void;
  auth.getUser.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => window.dispatchEvent(new Event('pageshow')));
  act(() => window.dispatchEvent(new Event('beforeunload')));
  expect(screen.queryByText('Private athlete report')).toBeNull();
  await act(async () => {
    finish({
      data: { user: null },
      error: new Error('navigation canceled fetch'),
    });
  });
  expect(auth.replace).not.toHaveBeenCalled();
  expect(screen.queryByText('Private athlete report')).toBeNull();
});
test('active-document getUser errors still fail closed and redirect', async () => {
  auth.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: new Error('unavailable'),
  });
  await open();
  expect(screen.queryByText('Private athlete report')).toBeNull();
  expect(auth.replace).toHaveBeenCalled();
});
test('signed-out, account-switch and expiry signals remain masked while departing', async () => {
  vi.useFakeTimers();
  await open();
  act(() =>
    auth.changed?.('INITIAL_SESSION', {
      user: { id: 'owner-fixture' },
      expires_at: Math.floor(Date.now() / 1000) + 2,
    }),
  );
  act(() => window.dispatchEvent(new Event('beforeunload')));
  act(() => vi.advanceTimersByTime(2000));
  act(() => auth.changed?.('SIGNED_OUT', null));
  act(() =>
    auth.changed?.('SIGNED_IN', {
      user: { id: 'other-fixture' },
      expires_at: Math.floor(Date.now() / 1000) + 60,
    }),
  );
  expect(screen.queryByText('Private athlete report')).toBeNull();
  expect(auth.replace).not.toHaveBeenCalled();
});
test('pageshow after departure requires fresh proof and rejects a revoked session', async () => {
  await open();
  act(() => window.dispatchEvent(new Event('beforeunload')));
  let finish!: (value: any) => void;
  auth.getUser.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => window.dispatchEvent(new Event('pageshow')));
  expect(screen.queryByText('Private athlete report')).toBeNull();
  await act(async () => {
    finish({ data: { user: null }, error: null });
  });
  expect(auth.replace).toHaveBeenCalled();
  expect(screen.queryByText('Private athlete report')).toBeNull();
});
test.each(['pointerdown', 'keydown'])(
  'canceled-navigation trusted %s restores only after fresh proof and keeps expiry timer',
  async (eventName) => {
    vi.useFakeTimers();
    const listeners = vi.spyOn(document, 'addEventListener');
    await open();
    act(() =>
      auth.changed?.('INITIAL_SESSION', {
        user: { id: 'owner-fixture' },
        expires_at: Math.floor(Date.now() / 1000) + 2,
      }),
    );
    act(() => window.dispatchEvent(new Event('beforeunload')));
    expect(screen.queryByText('Private athlete report')).toBeNull();
    let finish!: (value: any) => void;
    auth.getUser.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const interact = listeners.mock.calls.find(
      ([name]) => name === 'pointerdown',
    )?.[1] as EventListener;
    act(() => interact({ isTrusted: true } as Event));
    listeners.mockRestore();
    expect(screen.queryByText('Private athlete report')).toBeNull();
    await act(async () => {
      finish({ data: { user: { id: 'owner-fixture' } }, error: null });
    });
    expect(screen.getByText('Private athlete report')).toBeTruthy();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByText('Private athlete report')).toBeNull();
    expect(auth.replace).toHaveBeenCalled();
  },
);
test('synthetic interaction cannot reactivate a departing document', async () => {
  await open();
  const calls = auth.getUser.mock.calls.length;
  act(() => window.dispatchEvent(new Event('beforeunload')));
  act(() => document.dispatchEvent(new Event('pointerdown')));
  act(() => document.dispatchEvent(new Event('keydown')));
  expect(auth.getUser).toHaveBeenCalledTimes(calls);
  expect(screen.queryByText('Private athlete report')).toBeNull();
});

test('pagehide without beforeunload masks, invalidates pending proof and requires fresh pageshow authority', async () => {
  await open();
  expect(screen.getByText('Private athlete report')).toBeTruthy();
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(screen.queryByText('Private athlete report')).toBeNull();
  let finishOld!: (value: any) => void;
  auth.getUser.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  act(() => window.dispatchEvent(new Event('pageshow')));
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(screen.queryByText('Private athlete report')).toBeNull();
  await act(async () => {
    finishOld({ data: { user: { id: 'owner-fixture' } }, error: null });
  });
  expect(screen.queryByText('Private athlete report')).toBeNull();
  expect(auth.replace).not.toHaveBeenCalled();
  let finishFresh!: (value: any) => void;
  auth.getUser.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishFresh = resolve;
      }),
  );
  act(() => window.dispatchEvent(new Event('pageshow')));
  expect(screen.queryByText('Private athlete report')).toBeNull();
  await act(async () => {
    finishFresh({ data: { user: { id: 'owner-fixture' } }, error: null });
  });
  expect(screen.getByText('Private athlete report')).toBeTruthy();
});

test('hidden document trusted input never resumes departing verification', async () => {
  const listeners = vi.spyOn(document, 'addEventListener');
  await open();
  const calls = auth.getUser.mock.calls.length;
  act(() => window.dispatchEvent(new Event('beforeunload')));
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  for (const eventName of ['pointerdown', 'keydown']) {
    const interact = listeners.mock.calls.find(
      ([name]) => name === eventName,
    )?.[1] as EventListener;
    act(() => interact({ isTrusted: true } as Event));
  }
  expect(auth.getUser).toHaveBeenCalledTimes(calls);
  expect(screen.queryByText('Private athlete report')).toBeNull();
  visibility.mockRestore();
  listeners.mockRestore();
});
test('cleanup removes every new departure and trusted-interaction listener', async () => {
  const windowAdded = vi.spyOn(window, 'addEventListener');
  const documentAdded = vi.spyOn(document, 'addEventListener');
  const windowRemoved = vi.spyOn(window, 'removeEventListener');
  const documentRemoved = vi.spyOn(document, 'removeEventListener');
  await open();
  cleanup();
  for (const name of ['beforeunload', 'pagehide', 'online']) {
    const listener = windowAdded.mock.calls.find(([event]) => event === name)?.[1];
    expect(listener).toBeTypeOf('function');
    expect(windowRemoved).toHaveBeenCalledWith(name, listener);
  }
  for (const name of ['pointerdown', 'keydown']) {
    const listener = documentAdded.mock.calls.find(([event]) => event === name)?.[1];
    expect(listener).toBeTypeOf('function');
    expect(documentRemoved).toHaveBeenCalledWith(name, listener);
  }
  windowAdded.mockRestore();
  documentAdded.mockRestore();
  windowRemoved.mockRestore();
  documentRemoved.mockRestore();
});

test.each(['returned', 'thrown'])(
  'transport failure (%s) stays masked on route until online fresh proof',
  async (kind) => {
    await open();
    const error = new AuthRetryableFetchError('offline', 0);
    if (kind === 'returned') auth.getUser.mockResolvedValueOnce({ data: { user: null }, error });
    else auth.getUser.mockRejectedValueOnce(error);
    await act(async () => window.dispatchEvent(new Event('pageshow')));
    expect(screen.queryByText('Private athlete report')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Reconnect');
    expect(auth.replace).not.toHaveBeenCalled();
    let finish!: (value: any) => void;
    auth.getUser.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    act(() => window.dispatchEvent(new Event('online')));
    expect(screen.queryByText('Private athlete report')).toBeNull();
    await act(async () => finish({ data: { user: { id: 'owner-fixture' } }, error: null }));
    expect(screen.getByText('Private athlete report')).toBeTruthy();
    expect(auth.replace).not.toHaveBeenCalled();
  },
);

test.each(['SIGNED_OUT', 'account switch', 'expiry'])(
  'offline wait cannot recover after %s invalidates authority',
  async (reason) => {
    vi.useFakeTimers();
    await open();
    act(() =>
      auth.changed?.('INITIAL_SESSION', {
        user: { id: 'owner-fixture' },
        expires_at: Math.floor(Date.now() / 1000) + 2,
      }),
    );
    auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthRetryableFetchError('offline', 0),
    });
    await act(async () => window.dispatchEvent(new Event('pageshow')));
    if (reason === 'expiry') act(() => vi.advanceTimersByTime(2000));
    else
      act(() =>
        auth.changed?.(
          reason === 'SIGNED_OUT' ? reason : 'SIGNED_IN',
          reason === 'SIGNED_OUT'
            ? null
            : { user: { id: 'other-fixture' }, expires_at: Math.floor(Date.now() / 1000) + 60 },
        ),
      );
    const count = auth.getUser.mock.calls.length;
    act(() => window.dispatchEvent(new Event('online')));
    expect(auth.getUser).toHaveBeenCalledTimes(count);
    expect(screen.queryByText('Private athlete report')).toBeNull();
    expect(auth.replace).toHaveBeenCalled();
  },
);

test('reconnect refuses revoked session and stale proof after logout', async () => {
  await open();
  auth.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: new AuthRetryableFetchError('offline', 0),
  });
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  let finish!: (value: any) => void;
  auth.getUser.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => window.dispatchEvent(new Event('online')));
  act(() => auth.changed?.('SIGNED_OUT', null));
  await act(async () => finish({ data: { user: { id: 'owner-fixture' } }, error: null }));
  expect(screen.queryByText('Private athlete report')).toBeNull();
  expect(auth.replace).toHaveBeenCalled();
});

test('retryable HTTP server error retains existing fail-closed redirect contract', async () => {
  auth.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: new AuthRetryableFetchError('unavailable', 503),
  });
  await open();
  expect(screen.queryByText('Private athlete report')).toBeNull();
  expect(auth.replace).toHaveBeenCalled();
});

test('online fresh proof with revoked identity redirects without showing private content', async () => {
  await open();
  auth.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: new AuthRetryableFetchError('offline', 0),
  });
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
  await act(async () => window.dispatchEvent(new Event('online')));
  expect(screen.queryByText('Private athlete report')).toBeNull();
  expect(auth.replace).toHaveBeenCalled();
});

test('online cannot reverify a hidden or departing document, and cleanup removes retry', async () => {
  await open();
  auth.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: new AuthRetryableFetchError('offline', 0),
  });
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  const count = auth.getUser.mock.calls.length;
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => window.dispatchEvent(new Event('online')));
  expect(auth.getUser).toHaveBeenCalledTimes(count);
  visibility.mockRestore();
  act(() => window.dispatchEvent(new Event('pagehide')));
  act(() => window.dispatchEvent(new Event('online')));
  expect(auth.getUser).toHaveBeenCalledTimes(count);
  cleanup();
  act(() => window.dispatchEvent(new Event('online')));
  expect(auth.getUser).toHaveBeenCalledTimes(count);
});

test('manual retry recovers when connectivity returned before the failed request completed', async () => {
  await open();
  auth.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: new AuthRetryableFetchError('offline', 0),
  });
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  expect(screen.queryByText('Private athlete report')).toBeNull();
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Retry session verification' })),
  );
  expect(screen.getByText('Private athlete report')).toBeTruthy();
  expect(auth.replace).not.toHaveBeenCalled();
});

test.each(['expiry', 'null INITIAL_SESSION'])(
  'offline %s stays in hidden reconnect state and requires fresh online proof',
  async (reason) => {
    vi.useFakeTimers();
    await open();
    act(() =>
      auth.changed?.('INITIAL_SESSION', {
        user: { id: 'owner-fixture' },
        expires_at: Math.floor(Date.now() / 1000) + 2,
      }),
    );
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      if (reason === 'expiry') act(() => vi.advanceTimersByTime(2000));
      else act(() => auth.changed?.('INITIAL_SESSION', null));
      expect(screen.queryByText('Private athlete report')).toBeNull();
      expect(screen.getByRole('status').textContent).toContain('Reconnect');
      expect(auth.replace).not.toHaveBeenCalled();
      let finish!: (value: any) => void;
      auth.getUser.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      online.mockReturnValue(true);
      act(() => window.dispatchEvent(new Event('online')));
      expect(screen.queryByText('Private athlete report')).toBeNull();
      await act(async () => finish({ data: { user: { id: 'owner-fixture' } }, error: null }));
      expect(screen.getByText('Private athlete report')).toBeTruthy();
      expect(auth.replace).not.toHaveBeenCalled();
    } finally {
      online.mockRestore();
    }
  },
);

test.each(['SIGNED_OUT', 'account switch'])(
  'offline %s remains terminal and cannot recover the old account on reconnect',
  async (reason) => {
    await open();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      act(() =>
        auth.changed?.(
          reason === 'SIGNED_OUT' ? reason : 'SIGNED_IN',
          reason === 'SIGNED_OUT'
            ? null
            : { user: { id: 'other-fixture' }, expires_at: Math.floor(Date.now() / 1000) + 60 },
        ),
      );
      expect(screen.queryByText('Private athlete report')).toBeNull();
      expect(auth.replace).not.toHaveBeenCalled();
      act(() => auth.changed?.('INITIAL_SESSION', null));
      const count = auth.getUser.mock.calls.length;
      online.mockReturnValue(true);
      act(() => window.dispatchEvent(new Event('online')));
      expect(auth.getUser).toHaveBeenCalledTimes(count);
      expect(screen.queryByText('Private athlete report')).toBeNull();
      expect(auth.replace).toHaveBeenCalledWith(
        '/sign-in?next=%2Fapp%2Fclub%2Freports%3Ftryout%3Dfixture',
      );
    } finally {
      online.mockRestore();
    }
  },
);

test('null INITIAL_SESSION online preserves sign-in requirement', async () => {
  await open();
  act(() => auth.changed?.('INITIAL_SESSION', null));
  expect(screen.queryByText('Private athlete report')).toBeNull();
  expect(auth.replace).toHaveBeenCalled();
});

test('fresh online recovery restores expiry timer after offline null session', async () => {
  vi.useFakeTimers();
  await open();
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  try {
    act(() => auth.changed?.('INITIAL_SESSION', null));
    auth.getSession.mockResolvedValueOnce({
      data: {
        session: { user: { id: 'owner-fixture' }, expires_at: Math.floor(Date.now() / 1000) + 2 },
      },
      error: null,
    });
    online.mockReturnValue(true);
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(screen.getByText('Private athlete report')).toBeTruthy();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByText('Private athlete report')).toBeNull();
    expect(auth.replace).toHaveBeenCalled();
  } finally {
    online.mockRestore();
  }
});

test.each(['revoked', 'different account', 'already expired'])(
  'offline recovery refuses %s session even after fresh user check',
  async (reason) => {
    await open();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      act(() => auth.changed?.('INITIAL_SESSION', null));
      auth.getSession.mockResolvedValueOnce({
        data: {
          session:
            reason === 'revoked'
              ? null
              : {
                  user: { id: reason === 'different account' ? 'other-fixture' : 'owner-fixture' },
                  expires_at:
                    Math.floor(Date.now() / 1000) + (reason === 'already expired' ? -1 : 60),
                },
        },
        error: null,
      });
      online.mockReturnValue(true);
      await act(async () => window.dispatchEvent(new Event('online')));
      expect(screen.queryByText('Private athlete report')).toBeNull();
      expect(auth.replace).toHaveBeenCalled();
    } finally {
      online.mockRestore();
    }
  },
);

test('logout invalidates a pending expiry proof after the fresh user check', async () => {
  await open();
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  try {
    act(() => auth.changed?.('INITIAL_SESSION', null));
    let finish!: (value: any) => void;
    auth.getSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    online.mockReturnValue(true);
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(auth.getSession).toHaveBeenCalled();
    expect(screen.queryByText('Private athlete report')).toBeNull();
    act(() => auth.changed?.('SIGNED_OUT', null));
    await act(async () =>
      finish({
        data: {
          session: {
            user: { id: 'owner-fixture' },
            expires_at: Math.floor(Date.now() / 1000) + 60,
          },
        },
        error: null,
      }),
    );
    expect(screen.queryByText('Private athlete report')).toBeNull();
    expect(auth.replace).toHaveBeenCalled();
  } finally {
    online.mockRestore();
  }
});

test('transport failure during expiry proof stays masked and retry verifies both steps again', async () => {
  await open();
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  try {
    act(() => auth.changed?.('INITIAL_SESSION', null));
    auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthRetryableFetchError('transport unavailable', 0),
    });
    online.mockReturnValue(true);
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(screen.queryByText('Private athlete report')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Reconnect');
    expect(auth.replace).not.toHaveBeenCalled();
    const checks = auth.getUser.mock.calls.length;
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Retry session verification' })),
    );
    expect(auth.getUser.mock.calls.length).toBe(checks + 1);
    expect(auth.getSession).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Private athlete report')).toBeTruthy();
  } finally {
    online.mockRestore();
  }
});
