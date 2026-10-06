import React, { useImperativeHandle } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const state = vi.hoisted(() => ({
  props: {} as Record<string, any>,
  reload: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  share: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
  inject: vi.fn(),
  print: vi.fn(async () => ({ uri: '/cache/report.pdf' })),
  hardwareBack: null as null | (() => boolean),
}));
vi.mock('react-native-webview', () => ({
  WebView: React.forwardRef((props: Record<string, any>, ref) => {
    state.props = props;
    useImperativeHandle(ref, () => ({
      injectJavaScript: state.inject,
      reload: state.reload,
      goBack: state.back,
      goForward: state.forward,
    }));
    return <div data-testid="workspace" />;
  }),
}));
vi.mock('../src/NativeBilling', () => ({
  default: ({ embeddedSession, onReturn }: any) => (
    <div>
      Native billing {embeddedSession.user.id}
      <button onClick={onReturn}>Return</button>
    </div>
  ),
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'trusted-instance-nonce' }));
vi.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/cache/',
  readDirectoryAsync: async () => [],
  moveAsync: async () => undefined,
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: state.write,
  deleteAsync: state.remove,
}));
vi.mock('expo-print', () => ({ printToFileAsync: state.print }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: state.share }));
vi.mock('react-native', () => {
  const Box = ({ children }: any) => <div>{children}</div>;
  return {
    View: Box,
    SafeAreaView: Box,
    Text: ({ children, accessibilityRole }: any) => (
      <span role={accessibilityRole}>{children}</span>
    ),
    Pressable: ({ children, onPress, disabled, accessibilityLabel, accessibilityState }: any) => (
      <button
        aria-label={accessibilityLabel}
        aria-busy={accessibilityState?.busy}
        disabled={disabled}
        onClick={onPress}
      >
        {children}
      </button>
    ),
    ActivityIndicator: ({ animating }: any) => (
      <span data-animating={String(animating)}>Loading</span>
    ),
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => true,
      addEventListener: () => ({ remove() {} }),
    },
    StatusBar: Object.assign(() => null, { currentHeight: 30 }),
    StyleSheet: { create: (x: any) => x },
    Platform: { OS: 'ios' },
    BackHandler: {
      addEventListener: (_event: string, callback: () => boolean) => {
        state.hardwareBack = callback;
        return { remove() {} };
      },
    },
    Linking: { getInitialURL: async () => null, addEventListener: () => ({ remove() {} }) },
  };
});
import Workspace from '../src/Workspace';
import {
  getWorkspaceSession,
  parseWorkspaceSession,
  setWorkspaceSession,
} from '../src/workspace-session';
import { reportDownload, workspaceNavigation } from '../src/workspace-navigation';
import { Action } from '../src/Action';
const origin = 'https://www.tryout.agency';
const account = '11111111-1111-4111-8111-111111111111';
function message(payload: any, url = `${origin}/app/club/home`) {
  return state.props.onMessage({ nativeEvent: { url, data: JSON.stringify(payload) } });
}
function session(userId = account) {
  return {
    type: 'session',
    nonce: 'trusted-instance-nonce',
    session: {
      userId,
      accessToken: `fixture.${btoa(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  setWorkspaceSession(null);
});
afterEach(cleanup);
test('only same-service workspace destinations can navigate; billing routes are intercepted including deep links', () => {
  expect(workspaceNavigation(`${origin}/app/club/evaluate`, origin)).toBe('allow');
  for (const path of [
    '/pricing',
    '/app/club/organization/billing',
    '/api/organizations/id/billing/checkout',
  ])
    expect(workspaceNavigation(origin + path, origin)).toBe('billing');
  for (const url of [
    'https://checkout.stripe.com/x',
    'https://www.tryout.agency.evil/app',
    'javascript:alert(1)',
    `${origin}/appevil`,
    `${origin}/api/jobs/process`,
  ])
    expect(workspaceNavigation(url, origin)).toBe('blocked');
  expect(reportDownload(`${origin}/app/club/reports/scouting/export`, origin)).toBe(true);
  expect(reportDownload('https://evil.example/report', origin)).toBe(false);
});
test('expired, malformed and excessively long-lived bridge sessions are rejected', () => {
  const data = session().session;
  expect(parseWorkspaceSession(data)?.user.id).toBe(account);
  expect(parseWorkspaceSession({ ...data, expiresAt: 1 })).toBeNull();
  expect(
    parseWorkspaceSession({ ...data, expiresAt: Math.floor(Date.now() / 1000) + 90000 }),
  ).toBeNull();
  expect(parseWorkspaceSession({ ...data, userId: 'other' })).toBeNull();
});
test('origin/nonce checks prevent bridge access; account switch and logout clear the native billing surface', async () => {
  await act(async () => {
    render(<Workspace />);
  });
  await act(async () => {
    await message(session(), 'https://evil.example/app');
    await message({ ...session(), nonce: 'wrong' });
  });
  expect(getWorkspaceSession()).toBeNull();
  expect(screen.queryByRole('button', { name: 'Billing & access' })).toBeNull();
  await act(async () => {
    await message(session());
  });
  await act(async () => {
    await message(
      { type: 'billing', nonce: 'trusted-instance-nonce', userId: account, slug: 'club' },
      `${origin}/app/club/organization/billing`,
    );
  });
  expect(state.props.containerStyle).toMatchObject({ flex: 0, height: 0, maxHeight: 0 });
  expect(await screen.findByText(`Native billing ${account}`)).toBeTruthy();
  const next = '22222222-2222-4222-8222-222222222222';
  await act(async () => {
    await message(session(next));
  });
  expect(screen.queryByText(`Native billing ${account}`)).toBeNull();
  expect(getWorkspaceSession()?.user.id).toBe(next);
  await act(async () => {
    await message({ type: 'session', nonce: 'trusted-instance-nonce', session: null });
  });
  expect(getWorkspaceSession()).toBeNull();
});
test('network interruption exposes retry and explicit iOS history preserves hardware Back', async () => {
  await act(async () => {
    render(<Workspace />);
  });
  act(() => state.props.onError());
  expect(screen.getByRole('alert').textContent).toContain('Check your connection');
  fireEvent.click(screen.getByRole('button', { name: 'Retry workspace' }));
  expect(state.reload).toHaveBeenCalledTimes(1);
  act(() => {
    state.props.onNavigationStateChange({
      url: `${origin}/app/club/home`,
      canGoBack: true,
      canGoForward: true,
    });
    state.props.onLoadEnd();
  });
  act(() =>
    state.props.onNavigationStateChange({
      url: `${origin}/app/club/evaluate`,
      canGoBack: true,
      canGoForward: true,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
  expect(state.forward).toHaveBeenCalledTimes(1);
  act(() => {
    expect(state.hardwareBack?.()).toBe(true);
  });
  expect(state.back).toHaveBeenCalledTimes(2);
  expect(state.props.allowsBackForwardNavigationGestures).toBe(true);
  expect(
    state.props.onShouldStartLoadWithRequest({ url: 'https://checkout.stripe.com/payment' }),
  ).toBe(false);
});
test('authenticated reports use the share sheet once and remove temporary content, never opening an external checkout', async () => {
  await act(async () => {
    render(<Workspace />);
  });
  await act(async () => {
    await message(session());
  });
  const report = {
    type: 'report',
    userId: account,
    mime: 'text/csv',
    nonce: 'trusted-instance-nonce',
    requestId: 'report-one',
    data: 'YSwxCg==',
  };
  await act(async () => {
    await message(report);
    await message(report);
  });
  expect(state.share).toHaveBeenCalledTimes(1);
  expect(state.write).toHaveBeenCalledTimes(1);
  expect(state.remove).toHaveBeenCalledTimes(1);
  await act(async () => {
    await message({ ...report, requestId: 'report-two' }, 'https://evil.example/app');
  });
  expect(state.share).toHaveBeenCalledTimes(1);
});
test('action feedback is immediate, reduced-motion safe and prevents repeat mutations; failed actions permit retry', async () => {
  let reject!: (reason: Error) => void;
  const run = vi.fn(
    () =>
      new Promise<void>((_resolve, r) => {
        reject = r;
      }),
  );
  await act(async () => {
    render(<Action title="Save evaluation" onPress={run} />);
  });
  const button = screen.getByRole('button', { name: 'Save evaluation' });
  act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  expect(run).toHaveBeenCalledTimes(1);
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(screen.getByText('Loading').getAttribute('data-animating')).toBe('false');
  await act(async () => {
    reject(new Error('simulated offline'));
  });
  expect(screen.getByRole('alert').textContent).toContain('Please try again');
  expect((button as HTMLButtonElement).disabled).toBe(false);
});

test('SPA billing entry is bound to the current account and exact workspace; challenge frames never become the app', async () => {
  await act(async () => {
    render(<Workspace />);
  });
  await act(async () => {
    await message(session());
  });
  const billing = {
    type: 'billing',
    nonce: 'trusted-instance-nonce',
    userId: account,
    slug: 'club',
  };
  await act(async () => {
    await message(billing);
    await message({ ...billing, userId: 'wrong' }, `${origin}/app/club/organization/billing`);
  });
  expect(screen.queryByText(`Native billing ${account}`)).toBeNull();
  await act(async () => {
    await message(billing, `${origin}/app/club/organization/billing`);
  });
  expect(screen.getByText(`Native billing ${account}`)).toBeTruthy();
  expect(
    state.props.onShouldStartLoadWithRequest({
      url: 'https://challenges.cloudflare.com/turnstile',
      isTopFrame: false,
    }),
  ).toBe(true);
  expect(
    state.props.onShouldStartLoadWithRequest({
      url: 'https://challenges.cloudflare.com/turnstile',
      isTopFrame: true,
    }),
  ).toBe(false);
  expect(
    state.props.onShouldStartLoadWithRequest({ url: 'https://evil.example/', isTopFrame: false }),
  ).toBe(false);
});
test('PDF and durable JSON exports share the right type, acknowledge completion and clean temporary files', async () => {
  await act(async () => {
    render(<Workspace />);
  });
  await act(async () => {
    await message(session());
  });
  await act(async () => {
    await message({
      type: 'print',
      nonce: 'trusted-instance-nonce',
      userId: account,
      requestId: 'pdf',
      html: '<html><body>Authorized fixture report</body></html>',
    });
  });
  expect(state.share).toHaveBeenCalledWith(
    '/cache/tryoutflow-report-trusted-instance-nonce.pdf',
    expect.objectContaining({ mimeType: 'application/pdf' }),
  );
  expect(state.inject.mock.calls.at(-1)?.[0]).toContain('Share sheet closed');
  await act(async () => {
    await message({
      type: 'report',
      nonce: 'trusted-instance-nonce',
      userId: account,
      requestId: 'json',
      mime: 'application/json',
      data: 'e30=',
    });
  });
  expect(state.share).toHaveBeenLastCalledWith(
    expect.stringContaining('.json'),
    expect.objectContaining({ mimeType: 'application/json', UTI: 'public.json' }),
  );
  expect(state.remove).toHaveBeenCalledTimes(2);
});
test('account switch while preparing an export prevents sharing the previous account data', async () => {
  let finish!: () => void;
  state.write.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    render(<Workspace />);
  });
  await act(async () => {
    await message(session());
  });
  let pending: Promise<void>;
  act(() => {
    pending = message({
      type: 'report',
      nonce: 'trusted-instance-nonce',
      userId: account,
      requestId: 'switch',
      mime: 'text/csv',
      data: 'YQ==',
    });
  });
  await act(async () => {
    await Promise.resolve();
    await message(session('22222222-2222-4222-8222-222222222222'));
  });
  await act(async () => {
    finish();
    await pending!;
  });
  expect(state.share).not.toHaveBeenCalled();
  expect(state.remove).toHaveBeenCalledTimes(1);
  expect(state.inject.mock.calls.at(-1)?.[0]).toContain('could not finish');
});

test('returning from SPA billing uses dashboard history and restores full web wrapper', async () => {
  await act(async () => {
    render(<Workspace />);
  });
  await act(async () => {
    await message(session());
  });
  act(() =>
    state.props.onNavigationStateChange({
      url: `${origin}/app/club/organization/billing`,
      canGoBack: true,
    }),
  );
  await act(async () => {
    await message(
      { type: 'billing', nonce: 'trusted-instance-nonce', userId: account, slug: 'club' },
      `${origin}/app/club/organization/billing`,
    );
  });
  fireEvent.click(screen.getByRole('button', { name: 'Return' }));
  expect(state.back).toHaveBeenCalledTimes(1);
  expect(state.props.containerStyle).toEqual({ flex: 1 });
});
