vi.mock('next/navigation', () => ({ usePathname: () => '/app/club/home' }));
import Link from 'next/link';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  change: null as null | ((event: string, session: any) => void),
  post: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock('../../../src/infrastructure/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getSession: auth.getSession,
      onAuthStateChange: (fn: any) => {
        auth.change = fn;
        return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
      },
    },
  }),
}));
import { NativeWorkspaceBridge } from '../../../src/modules/identity/ui/native-workspace-bridge';
const native = window as any;
beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  native.ReactNativeWebView = { postMessage: auth.post };
  native.__tryoutflowNonce = 'fixture-instance';
});
afterEach(() => {
  cleanup();
  delete native.ReactNativeWebView;
  delete native.__tryoutflowNonce;
  vi.unstubAllGlobals();
});
test('ordinary web browser never opens an auth bridge', () => {
  delete native.ReactNativeWebView;
  render(<NativeWorkspaceBridge />);
  expect(auth.getSession).not.toHaveBeenCalled();
});
test('only short-lived access identity is bridged; refresh token/password never leave the browser, and logout clears native identity', async () => {
  auth.getSession.mockResolvedValue({
    data: {
      session: {
        access_token: 'synthetic.fixture.token',
        refresh_token: 'DO_NOT_BRIDGE',
        expires_at: 123,
        user: { id: 'fixture-user' },
        password: 'NEVER_BRIDGE',
      },
    },
  });
  await act(async () => {
    render(<NativeWorkspaceBridge />);
  });
  const body = auth.post.mock.calls
    .map(([value]) => JSON.parse(value))
    .find((value) => value.type === 'session');
  expect(body.session).toEqual({
    accessToken: 'synthetic.fixture.token',
    expiresAt: 123,
    userId: 'fixture-user',
  });
  expect(body.nonce).toBe('fixture-instance');
  expect(JSON.stringify(auth.post.mock.calls)).not.toContain('DO_NOT_BRIDGE');
  expect(JSON.stringify(auth.post.mock.calls)).not.toContain('NEVER_BRIDGE');
  act(() => auth.change?.('SIGNED_OUT', null));
  expect(JSON.parse(auth.post.mock.calls.at(-1)![0]).session).toBeNull();
  cleanup();
  expect(auth.unsubscribe).toHaveBeenCalledTimes(1);
});
test('report interruption stays visible, repeated clicks issue one request and a failed export is retryable', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () => {
    render(
      <>
        <NativeWorkspaceBridge />
        <Link href="/app/club/reports/scouting/export">Download CSV</Link>
      </>,
    );
  });
  const link = screen.getByRole('link', { name: 'Download CSV' });
  fireEvent.click(link);
  fireEvent.click(link);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(link).toHaveAttribute('aria-busy', 'true');
  await act(async () => finish(new Response('unavailable', { status: 403 })));
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Check your connection and access'),
  );
  expect(link).not.toHaveAttribute('aria-busy');
  expect(auth.post.mock.calls.some(([x]) => JSON.parse(x).type === 'report')).toBe(false);
  fireEvent.click(link);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('late native injection connects once and a delayed initial session cannot overwrite logout', async () => {
  let resolve!: (value: any) => void;
  auth.getSession.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  delete native.__tryoutflowNonce;
  render(<NativeWorkspaceBridge />);
  expect(auth.getSession).not.toHaveBeenCalled();
  native.__tryoutflowNonce = 'fixture-instance';
  act(() => window.dispatchEvent(new Event('tryoutflow-native-ready')));
  act(() => window.dispatchEvent(new Event('tryoutflow-native-ready')));
  expect(auth.getSession).toHaveBeenCalledTimes(1);
  act(() => auth.change?.('SIGNED_OUT', null));
  await act(async () =>
    resolve({ data: { session: { access_token: 'old', expires_at: 123, user: { id: 'old' } } } }),
  );
  const messages = auth.post.mock.calls
    .map(([value]) => JSON.parse(value))
    .filter((value) => value.type === 'session');
  expect(messages).toHaveLength(1);
  expect(messages[0].session).toBeNull();
});

test('successful exports stay busy until the native share sheet acknowledgement and ignore unrelated replies', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('a,b\n', { headers: { 'content-type': 'text/csv' } })),
  );
  vi.stubGlobal(
    'FileReader',
    class {
      result = 'data:text/csv;base64,YSxiCg==';
      onload?: () => void;
      readAsDataURL() {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  await act(async () => {
    render(
      <>
        <NativeWorkspaceBridge />
        <Link href="/app/club/reports/scouting/export">Download CSV</Link>
      </>,
    );
  });
  act(() =>
    auth.change?.('SIGNED_IN', {
      access_token: 'fixture',
      expires_at: 123,
      user: { id: 'fixture-user' },
    }),
  );
  const link = screen.getByRole('link', { name: 'Download CSV' });
  await act(async () => fireEvent.click(link));
  expect(link).toHaveAttribute('aria-busy', 'true');
  const report = auth.post.mock.calls.map(([v]) => JSON.parse(v)).find((v) => v.type === 'report');
  expect(report.userId).toBe('fixture-user');
  act(() =>
    window.dispatchEvent(
      new CustomEvent('tryoutflow-file-result', {
        detail: { nonce: 'wrong', requestId: report.requestId, message: 'No' },
      }),
    ),
  );
  expect(link).toHaveAttribute('aria-busy', 'true');
  act(() =>
    window.dispatchEvent(
      new CustomEvent('tryoutflow-file-result', {
        detail: {
          nonce: 'fixture-instance',
          requestId: report.requestId,
          message: 'Report prepared. Share sheet closed.',
        },
      }),
    ),
  );
  expect(link).not.toHaveAttribute('aria-busy');
  expect(screen.getByRole('status')).toHaveTextContent('Share sheet closed');
});
