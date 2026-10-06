import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DemoWorkspace } from '@/modules/demo/demo-workspace';
import { createDemo, DEMO_DURATION_MS, DEMO_STORAGE_KEY } from '@/modules/demo/demo-state';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-20T12:00:00Z'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

it('supports check-in, evaluation, ranking and roster changes without network requests', () => {
  const request = vi.spyOn(globalThis, 'fetch');
  render(<DemoWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Check-in' }));
  fireEvent.click(screen.getByRole('button', { name: 'Check in Demo Athlete 07' }));
  expect(screen.getByRole('button', { name: 'Undo check-in for Demo Athlete 07' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Evaluate' }));
  for (const criterion of ['Skating', 'Puck control', 'Teamwork'])
    fireEvent.click(screen.getByRole('radio', { name: `${criterion} score 5 of 5` }));
  expect(screen.getByText('Evaluation complete · Average 5.00 / 5')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'View updated rankings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select Demo Athlete 07' }));
  fireEvent.click(screen.getByRole('button', { name: 'Roster' }));
  expect(screen.getByRole('heading', { name: 'Draft roster · 3 athletes' })).toBeVisible();
  expect(request).not.toHaveBeenCalled();
});

it('resets data and the visible workspace at 30 minutes', () => {
  render(<DemoWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Check-in' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add sample registration' }));
  act(() => {
    vi.advanceTimersByTime(DEMO_DURATION_MS - 1000);
  });
  expect(screen.getByTestId('demo-countdown')).toHaveTextContent('0:01');
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(screen.getByTestId('demo-countdown')).toHaveTextContent('30:00');
  expect(screen.getByRole('region', { name: 'Demo overview' })).toBeVisible();
  expect(JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY)!).athletes).toHaveLength(8);
  expect(screen.getByRole('status')).toHaveTextContent('30-minute demo has reset');
});

it('preserves data and deadline across reloads, then resets on return after expiry', () => {
  const first = render(<DemoWorkspace />);
  fireEvent.change(screen.getByLabelText('Try renaming the event'), {
    target: { value: 'My demo tryout' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save event name' }));
  first.unmount();
  vi.setSystemTime(Date.now() + 60000);
  const second = render(<DemoWorkspace />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('My demo tryout');
  expect(screen.getByTestId('demo-countdown')).toHaveTextContent('29:00');
  second.unmount();
  vi.setSystemTime(Date.now() + DEMO_DURATION_MS);
  render(<DemoWorkspace />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('U15 Hockey');
});

it('resets promptly when a suspended tab regains focus', () => {
  render(<DemoWorkspace />);
  vi.setSystemTime(Date.now() + DEMO_DURATION_MS + 1);
  fireEvent(window, new Event('focus'));
  expect(screen.getByTestId('demo-countdown')).toHaveTextContent('30:00');
  expect(screen.getByRole('status')).toHaveTextContent('has reset');
});

it('reflects another tab resetting the same browser session', () => {
  render(<DemoWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Evaluate' }));
  vi.setSystemTime(Date.now() + 5000);
  fireEvent(
    window,
    new StorageEvent('storage', {
      key: DEMO_STORAGE_KEY,
      newValue: JSON.stringify(createDemo(Date.now())),
    }),
  );
  expect(screen.getByRole('region', { name: 'Demo overview' })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('demo has reset');
});

it('still works and resets when browser storage is blocked', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  render(<DemoWorkspace />);
  expect(screen.getByText(/Browser storage is unavailable/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Evaluate' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Skating score 5 of 5' }));
  expect(screen.getByRole('radio', { name: 'Skating score 5 of 5' })).toBeChecked();
  act(() => {
    vi.advanceTimersByTime(DEMO_DURATION_MS);
  });
  expect(screen.getByRole('region', { name: 'Demo overview' })).toBeVisible();
});
