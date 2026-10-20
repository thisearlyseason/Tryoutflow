import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

const services = vi.hoisted(() => ({
  api: vi.fn(),
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
  getOfferings: async () => [],
  identifyPurchaser: async () => {},
  purchaseError: () => 'Purchase error',
  purchasePackage: async () => {},
  restorePurchases: async () => {},
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'attempt-id' }));
vi.mock('expo-secure-store', () => ({}));
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
    Platform: { OS: 'ios' },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => true,
      addEventListener: () => ({ remove() {} }),
    },
    StyleSheet: { create: (styles: unknown) => styles },
  };
});
import App from '../src/NativeBilling';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test('a failed organization switch does not show the previous organization plan or purchase actions', async () => {
  services.api.mockImplementation(async (path: string) => {
    if (path === '/api/billing/organizations')
      return {
        organizations: [
          {
            organization_id: 'org-a',
            role: 'owner',
            organizations: { id: 'org-a', name: 'Club A', slug: 'club-a' },
          },
          {
            organization_id: 'org-b',
            role: 'owner',
            organizations: { id: 'org-b', name: 'Club B', slug: 'club-b' },
          },
        ],
      };
    if (path === '/api/organizations/org-a/billing/actions')
      return {
        purchasesEnabled: false,
        access: { plan: 'pro', source: 'trial', features: {} },
        trial: { eligible: false, startsAt: null, expiresAt: null },
        subscriptions: [],
      };
    throw new Error('Organization B is temporarily unavailable.');
  });
  await act(async () => {
    render(<App />);
  });
  fireEvent.click(await screen.findByRole('button', { name: /Club A/ }));
  await screen.findByText('TryOutFlow Pro');
  fireEvent.click(screen.getByRole('button', { name: 'Open coaching workspace' }));
  await waitFor(() =>
    expect(services.openURL).toHaveBeenCalledWith('https://www.tryout.agency/app/club-a/home'),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Club B/ }).hasAttribute('disabled')).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: /Club B/ }));
  await screen.findByText('Organization B is temporarily unavailable.');
  expect(screen.queryByText('TryOutFlow Pro')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Restore purchases' })).toBeNull();
});

// A slow response for the signed-out account must not appear in the next account.
test('an old account organization response is ignored after account switching', async () => {
  let finishFirst!: (value: unknown) => void;
  services.api
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    )
    .mockResolvedValueOnce({
      organizations: [
        {
          organization_id: 'org-b',
          role: 'owner',
          organizations: { id: 'org-b', name: 'New account club', slug: 'new-club' },
        },
      ],
    });
  await act(async () => {
    render(<App />);
  });
  await waitFor(() => expect(services.api).toHaveBeenCalledTimes(1));
  await act(async () => {
    services.authChanged?.('SIGNED_IN', { user: { id: 'user-2' } });
  });
  await screen.findByRole('button', { name: /New account club/ });
  await act(async () => {
    finishFirst({
      organizations: [
        {
          organization_id: 'org-a',
          role: 'owner',
          organizations: { id: 'org-a', name: 'Previous account club', slug: 'old-club' },
        },
      ],
    });
  });
  expect(screen.queryByRole('button', { name: /Previous account club/ })).toBeNull();
  expect(screen.getByRole('button', { name: /New account club/ })).toBeTruthy();
});

test('a refunded contract with a future period end does not appear as active access', async () => {
  services.api.mockImplementation(async (path: string) => {
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
    if (path === '/api/organizations/org-a/billing/actions')
      return {
        purchasesEnabled: false,
        access: { plan: 'free', source: 'free', features: {} },
        subscriptions: [
          {
            tryout_id: null,
            provider: 'apple',
            status: 'refunded',
            current_period_end: '2099-01-01T00:00:00Z',
            cancel_at_period_end: false,
            pending_product_key: null,
            downgrade_effective_at: null,
          },
        ],
      };
    throw new Error('Unexpected request');
  });
  await act(async () => {
    render(<App />);
  });
  fireEvent.click(await screen.findByRole('button', { name: /Club A/ }));
  await screen.findByText('TryOutFlow Free');
  expect(screen.queryByText('Your organization has access across supported devices.')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Manage subscription' })).toBeNull();
});
