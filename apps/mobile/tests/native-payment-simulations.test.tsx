import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const services = vi.hoisted(() => ({
  api: vi.fn(),
  purchase: vi.fn(),
  restore: vi.fn(),
  identify: vi.fn(),
  platform: 'ios',
  packages: [] as unknown[],
  storage: new Map<string, string>(),
  openURL: vi.fn().mockResolvedValue(undefined),
  authChanged: null as null | ((event: string, session: unknown) => void),
}));
vi.mock('../src/client', () => ({
  api: services.api,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }),
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        services.authChanged = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      startAutoRefresh() {},
      stopAutoRefresh() {},
    },
  },
}));
vi.mock('../src/native-billing', () => ({
  getOfferings: async () => services.packages,
  identifyPurchaser: services.identify,
  purchaseError: (error: { code?: string }) =>
    error.code === 'cancelled'
      ? 'Purchase cancelled.'
      : error.code === 'pending'
        ? 'Awaiting store approval.'
        : 'Purchase error',
  purchasePackage: services.purchase,
  restorePurchases: services.restore,
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'attempt-id' }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => services.storage.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => {
    services.storage.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    services.storage.delete(k);
  },
}));
vi.mock('react-native', () => {
  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Button: ({
      title,
      onPress,
      disabled,
    }: {
      title: string;
      onPress: () => void;
      disabled?: boolean;
    }) => (
      <button onClick={onPress} disabled={disabled}>
        {title}
      </button>
    ),
    View: Container,
    Image: Container,
    ScrollView: Container,
    SafeAreaView: Container,
    Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    Pressable: ({
      children,
      onPress,
      disabled,
    }: {
      children?: React.ReactNode;
      onPress: () => void;
      disabled: boolean;
    }) => (
      <button onClick={onPress} disabled={disabled}>
        {children}
      </button>
    ),
    TextInput: () => <input />,
    ActivityIndicator: () => <span>Loading</span>,
    AppState: { addEventListener: () => ({ remove() {} }) },
    Alert: { alert() {} },
    Linking: { openURL: services.openURL },
    Platform: {
      get OS() {
        return services.platform;
      },
    },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => true,
      addEventListener: () => ({ remove() {} }),
    },
    StyleSheet: { create: (styles: unknown) => styles },
  };
});

// SDK and backend responses are simulated: these are not real store transactions.
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  services.storage.clear();
  services.purchase.mockResolvedValue({});
  services.restore.mockResolvedValue({});
  services.identify.mockResolvedValue(undefined);
});
afterEach(cleanup);
async function show(platform: string, options: { mismatch?: boolean; disabled?: boolean } = {}) {
  services.platform = platform;
  const productId = platform === 'ios' ? 'agency.tryout.pro.monthly' : 'agency.tryout.pro:monthly';
  services.packages = [
    {
      identifier: 'pro_monthly',
      product: {
        identifier: productId,
        title: 'Pro',
        description: 'Pro plan',
        priceString: '$12.99',
      },
    },
  ];
  services.api.mockImplementation(async (path: string, body?: { action?: string }) => {
    if (path === '/api/billing/organizations')
      return {
        organizations: [
          {
            organization_id: 'org-a',
            role: 'owner',
            organizations: { id: 'org-a', name: 'Club A', slug: 'club-a' },
          },
        ],
      };
    if (body?.action === 'purchase')
      return { productId: options.mismatch ? 'other.product' : productId };
    if (body?.action) return {};
    return {
      purchasesEnabled: !options.disabled,
      access: { plan: 'free', source: 'free', features: {} },
      trial: { eligible: false },
      subscriptions: [],
      tryouts: [],
    };
  });
  const { default: App } = await import('../src/NativeBilling');
  await act(async () => {
    render(<App />);
  });
  fireEvent.click(await screen.findByRole('button', { name: /Club A/ }));
  await screen.findByText('TryOutFlow Free');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Restore purchases' }).hasAttribute('disabled')).toBe(
      false,
    ),
  );
  return productId;
}
for (const platform of ['ios', 'android']) {
  test(`${platform}: simulated cancellation and pending receipt keep Free access and retry identity`, async () => {
    await show(platform);
    services.purchase
      .mockRejectedValueOnce({ code: 'cancelled' })
      .mockRejectedValueOnce({ code: 'pending' });
    fireEvent.click(await screen.findByRole('button', { name: '$12.99 · month' }));
    await screen.findByText('Purchase cancelled.');
    fireEvent.click(screen.getByRole('button', { name: '$12.99 · month' }));
    await screen.findByText('Awaiting store approval.');
    expect(screen.getByText('TryOutFlow Free')).toBeTruthy();
    const intents = services.api.mock.calls.filter((c) => c[1]?.action === 'purchase');
    expect(intents).toHaveLength(2);
    expect(intents[0]![1]!.attemptId).toBe(intents[1]![1]!.attemptId);
    expect(intents[0]![1]!.provider).toBe(platform === 'ios' ? 'apple' : 'google');
    expect(services.api.mock.calls.some((c) => c[1]?.action === 'reconcile')).toBe(false);
  });
  test(`${platform}: mismapped backend product never opens a store purchase`, async () => {
    await show(platform, { mismatch: true });
    fireEvent.click(await screen.findByRole('button', { name: '$12.99 · month' }));
    await screen.findByText('The store product configuration needs attention.');
    expect(services.purchase).not.toHaveBeenCalled();
  });
  test(`${platform}: repeated taps create one pending store transaction; SDK success alone does not grant access`, async () => {
    await show(platform);
    let finish!: () => void;
    services.purchase.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const buy = await screen.findByRole('button', { name: '$12.99 · month' });
    fireEvent.click(buy);
    fireEvent.click(buy);
    await waitFor(() => expect(services.purchase).toHaveBeenCalledTimes(1));
    await act(async () => {
      finish();
    });
    await screen.findByText(/Purchase received. Access updates after secure confirmation/);
    expect(screen.getByText('TryOutFlow Free')).toBeTruthy();
    expect(services.api.mock.calls.filter((c) => c[1]?.action === 'reconcile')).toHaveLength(1);
  });
  test(`${platform}: restore failure never claims success; successful restore still uses backend access`, async () => {
    await show(platform);
    services.restore.mockRejectedValueOnce(new Error('Store unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Restore purchases' }));
    await screen.findByText('Store unavailable');
    expect(services.api.mock.calls.some((c) => c[1]?.action === 'restore')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Restore purchases' }));
    await screen.findByText('Purchase records checked. Your current access is shown above.');
    expect(screen.getByText('TryOutFlow Free')).toBeTruthy();
    expect(services.identify).toHaveBeenLastCalledWith('user-1');
  });
  test(`${platform}: disabled provider gate never shows a purchase option`, async () => {
    await show(platform, { disabled: true });
    expect(screen.queryByRole('button', { name: '$12.99 · month' })).toBeNull();
    expect(services.purchase).not.toHaveBeenCalled();
  });
}
