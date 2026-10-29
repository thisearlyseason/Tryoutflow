import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { NavigationLink } from '@/components/layout/app-navigation';
const state = vi.hoisted(() => ({ pending: true }));
vi.mock('next/link', async (original) => ({
  ...(await original<object>()),
  useLinkStatus: () => state,
}));
it('acknowledges a pending navigation without changing its accessible name, then clears on completion', () => {
  const item = { href: '/app/fictional/tryouts', label: 'Tryouts', icon: 'tryouts' as const };
  const { rerender } = render(<NavigationLink item={item} pathname="/app/fictional/home" />);
  const link = screen.getByRole('link', { name: /^Tryouts$/u });
  expect(within(link).getByRole('status')).toHaveTextContent('Opening Tryouts…');
  expect(link.querySelector('[data-pending="true"]')).not.toBeNull();
  state.pending = false;
  rerender(<NavigationLink item={item} pathname="/app/fictional/tryouts" />);
  expect(screen.getByRole('link', { name: /^Tryouts$/u })).toHaveAttribute('aria-current', 'page');
  expect(within(link).queryByRole('status')).toBeNull();
  expect(link.querySelector('[data-pending="true"]')).toBeNull();
});
