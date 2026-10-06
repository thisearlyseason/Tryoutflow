import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
const api = vi.hoisted(() => vi.fn());
vi.mock('../src/client', () => ({ api }));
vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  AccessibilityInfo: {
    isReduceMotionEnabled: async () => true,
    addEventListener: () => ({ remove() {} }),
  },
  ActivityIndicator: () => <span>Working</span>,
  StyleSheet: { create: (styles: unknown) => styles },
  Linking: { openURL: vi.fn() },
}));
import { AccountDeletion } from '../src/AccountDeletion';
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
test('opening and dismissing confirmation never files a request', () => {
  render(<AccountDeletion userId="user-test" />);
  fireEvent.click(screen.getByText('Delete account'));
  fireEvent.click(screen.getByText('Keep account'));
  expect(api).not.toHaveBeenCalled();
});
test('saves only after explicit confirmation and reports the server deadline', async () => {
  api.mockResolvedValue({ request: { id: 'request-test', dueAt: '2099-01-01T00:00:00Z' } });
  render(<AccountDeletion userId="user-test" />);
  fireEvent.click(screen.getByText('Delete account'));
  fireEvent.click(screen.getByText('Confirm deletion request'));
  await waitFor(() => expect(screen.getByText(/Request saved/)).toBeTruthy());
  expect(api).toHaveBeenCalledWith('/api/account/deletion', { confirm: true }, 'user-test');
  expect(screen.getByText(/request-test/)).toBeTruthy();
});
test('a server failure never appears as a saved deletion request', async () => {
  api.mockRejectedValue(new Error('Request could not be saved'));
  render(<AccountDeletion userId="user-test" />);
  fireEvent.click(screen.getByText('Delete account'));
  fireEvent.click(screen.getByText('Confirm deletion request'));
  await waitFor(() => expect(screen.getByText('Request could not be saved')).toBeTruthy());
  expect(screen.queryByText(/Request saved/)).toBeNull();
});
