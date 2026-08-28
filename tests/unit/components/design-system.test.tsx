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

  it('keeps controls at the 44 px mobile target and gives keyboard focus an electric-blue ring', () => {
    const { container } = render(<Input aria-label="Tryout name" />);
    const input = screen.getByRole('textbox', { name: 'Tryout name' });

    expect(getComputedStyle(document.documentElement).getPropertyValue('--target-mobile')).toBe(
      '44px',
    );
    expect(getComputedStyle(document.documentElement).getPropertyValue('--color-focus')).toBe(
      '#0057ff',
    );
    expect(container.firstChild).toHaveClass(
      'min-h-[var(--target-mobile)]',
      'focus:ring-[var(--color-focus)]',
    );
  });

  it('disables busy primary actions without replacing their accessible name', () => {
    render(<Button busy>Publish tryout</Button>);

    const button = screen.getByRole('button', { name: 'Publish tryout' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('pairs every status color with a readable status label', () => {
    render(<StatusBadge status="callback" />);

    expect(screen.getByText('Callback')).toBeVisible();
    expect(screen.getByText('Callback')).toHaveAttribute('data-status', 'callback');
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
