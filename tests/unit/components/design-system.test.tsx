import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppShell } from '../../../src/components/layout/app-shell';
import { MobileNav } from '../../../src/components/layout/mobile-nav';
import { EmptyState } from '../../../src/components/feedback/empty-state';
import { ErrorState } from '../../../src/components/feedback/error-state';
import { LoadingState } from '../../../src/components/feedback/loading-state';
import { Button } from '../../../src/components/ui/button';
import { Input } from '../../../src/components/ui/input';
import { StatusBadge } from '../../../src/components/ui/status-badge';

const themeCss = readFileSync(resolve(process.cwd(), 'src/app/theme.css'), 'utf8');

beforeEach(() => {
  const style = document.createElement('style');
  style.dataset.testTheme = 'true';
  style.textContent = themeCss;
  document.head.append(style);
});

afterEach(() => {
  document.querySelector('[data-test-theme="true"]')?.remove();
});

describe('TryoutFlow design system', () => {
  it('exposes a visible accessible primary action', () => {
    render(<Button>Publish tryout</Button>);

    expect(screen.getByRole('button', { name: 'Publish tryout' })).toBeEnabled();
    expect(document.documentElement).toHaveStyle({ colorScheme: 'light' });
  });

  it('keeps buttons, inputs, and mobile navigation links at the 44 px target', () => {
    render(
      <>
        <Button>Go</Button>
        <Input aria-label="Tryout name" />
        <MobileNav
          items={[
            { href: '/tryouts', label: 'Tryouts' },
            { href: '/athletes', label: 'Athletes' },
            { href: '/settings', label: 'Settings' },
          ]}
        />
      </>,
    );

    const button = screen.getByRole('button', { name: 'Go' });
    const input = screen.getByRole('textbox', { name: 'Tryout name' });

    expect(getComputedStyle(document.documentElement).getPropertyValue('--target-mobile')).toBe(
      '44px',
    );
    expect(button).toHaveClass('min-h-[var(--target-mobile)]', 'min-w-[var(--target-mobile)]');
    expect(input).toHaveClass('min-h-[var(--target-mobile)]', 'min-w-[var(--target-mobile)]');
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveClass('min-h-[var(--target-mobile)]', 'min-w-[var(--target-mobile)]');
    }
  });

  it('gives keyboard focus an electric-blue ring', () => {
    render(<Input aria-label="Tryout name" />);
    const input = screen.getByRole('textbox', { name: 'Tryout name' });

    expect(getComputedStyle(document.documentElement).getPropertyValue('--color-focus')).toBe(
      '#0057ff',
    );
    expect(input).toHaveClass('focus:ring-[var(--color-focus)]');
  });

  it('disables busy primary actions without replacing their accessible name', () => {
    render(<Button busy>Publish tryout</Button>);

    const button = screen.getByRole('button', { name: 'Publish tryout' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('pairs every status color with a readable status label', () => {
    const statuses = [
      ['callback', 'Callback'],
      ['complete', 'Complete'],
      ['in-progress', 'In progress'],
      ['selected', 'Selected'],
      ['waitlisted', 'Waitlisted'],
    ] as const;

    render(
      <>
        {statuses.map(([status]) => (
          <StatusBadge key={status} status={status} />
        ))}
      </>,
    );

    for (const [status, label] of statuses) {
      expect(screen.getByText(label)).toBeVisible();
      expect(screen.getByText(label)).toHaveAttribute('data-status', status);
    }
  });

  it('removes nonessential animation when reduced motion is requested', () => {
    expect(getComputedStyle(document.documentElement).getPropertyValue('--duration-enter')).toBe(
      '160ms',
    );
    expect(document.head.textContent).toContain('prefers-reduced-motion: reduce');
  });

  it('renders semantic feedback and responsive navigation landmarks', () => {
    render(
      <AppShell navigation={<MobileNav items={[{ href: '/tryouts', label: 'Tryouts' }]} />}>
        <EmptyState title="No tryouts yet" action={<Button>Create tryout</Button>} />
        <ErrorState title="Could not load tryouts" />
        <LoadingState label="Loading tryouts" />
      </AppShell>,
    );

    expect(screen.getByRole('main')).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'No tryouts yet' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load tryouts');
    expect(screen.getByRole('status', { name: 'Loading tryouts' })).toBeVisible();
  });
});
