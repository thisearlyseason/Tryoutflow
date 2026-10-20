import Link from 'next/link';
import Image from 'next/image';
import { Brand } from '../ui/brand';
import type { ReactNode } from 'react';

export const marketingLinkClassName =
  'inline-flex min-h-[var(--target-mobile)] min-w-[var(--target-mobile)] items-center justify-center rounded-[var(--radius-control)] px-3 py-2 font-bold underline-offset-4 transition-colors duration-[var(--duration-enter)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:ring-offset-2';

const primaryLinks = [
  { href: '/features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/demo', label: 'Demo' },
  { href: '/how-to', label: 'How to' },
] as const;

const audienceLinks = [
  { href: '/for/teams', label: 'Teams' },
  { href: '/for/clubs', label: 'Clubs' },
  { href: '/for/associations', label: 'Associations' },
] as const;

export function MarketingShell({
  children,
  authenticated = false,
}: {
  children: ReactNode;
  authenticated?: boolean;
}) {
  return (
    <div className="min-h-dvh overflow-x-clip bg-[var(--color-canvas)] text-[var(--color-text)]">
      <a
        className={`${marketingLinkClassName} fixed left-3 top-3 z-50 -translate-y-24 bg-[var(--color-surface)] shadow-[var(--shadow-surface)] focus:translate-y-0`}
        href="#main-content"
      >
        Skip to content
      </a>
      <header className="border-b border-[var(--color-border)] bg-[var(--color-canvas)]">
        <nav
          aria-label="Primary navigation"
          className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-1 gap-y-2 px-3 py-3 sm:px-6 lg:px-8"
        >
          <Link
            prefetch={false}
            className={`${marketingLinkClassName} mr-auto justify-start px-1 text-lg font-black no-underline hover:no-underline`}
            href="/"
          >
            <Brand />
          </Link>
          <div className="order-3 flex w-full flex-wrap items-center gap-1 border-t border-[var(--color-border)] pt-2 sm:order-none sm:w-auto sm:border-0 sm:pt-0">
            {primaryLinks.map((item) => (
              <Link
                prefetch={false}
                className={marketingLinkClassName}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
          </div>
          <Link
            className={marketingLinkClassName}
            href={authenticated ? '/app' : '/sign-in'}
            prefetch={false}
          >
            {authenticated ? 'Dashboard' : 'Sign in'}
          </Link>
          <Link
            prefetch={false}
            className={`${marketingLinkClassName} bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:no-underline`}
            href="/demo"
          >
            Try the demo
          </Link>
        </nav>
      </header>
      <main className="outline-none" id="main-content" tabIndex={-1}>
        {children}
      </main>
      <footer className="border-t border-[var(--color-border)] bg-[var(--color-text)] text-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
          <div>
            <div className="brand-on-dark">
              <Brand />
            </div>
            <p className="mt-2 max-w-md text-sm text-[#d8dee6]">
              A structured workflow for registration, evaluation, rankings, rosters, and participant
              communication.
            </p>
          </div>
          <nav aria-label="Audience navigation">
            <p className="font-black">Built for</p>
            <div className="mt-2 flex flex-wrap gap-1 md:flex-col md:items-start">
              {audienceLinks.map((item) => (
                <Link
                  prefetch={false}
                  className={marketingLinkClassName}
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
          <nav aria-label="Legal navigation">
            <p className="font-black">Help and policies</p>
            <div className="mt-2 flex flex-wrap gap-1 md:flex-col md:items-start">
              <Link prefetch={false} className={marketingLinkClassName} href="/support">
                Support
              </Link>
              <Link prefetch={false} className={marketingLinkClassName} href="/delete-account">
                Delete account
              </Link>
              <Link prefetch={false} className={marketingLinkClassName} href="/privacy">
                Privacy
              </Link>
              <Link prefetch={false} className={marketingLinkClassName} href="/terms">
                Terms
              </Link>
            </div>
          </nav>
        </div>
        <div className="flex flex-col items-center gap-2 border-t border-white/20 px-4 py-5">
          <Image
            src="/brand/gameday-sports-dark.png"
            alt="Gameday Sports"
            width={1774}
            height={887}
            className="h-auto w-40"
          />
          <p className="text-sm text-[#d8dee6]">TryoutFlow is part of Gameday Sports.</p>
        </div>
        <p className="border-t border-white/20 px-4 py-5 text-center text-sm text-[#d8dee6]">
          TryoutFlow is operated by GameDay Technologies. Coaches and directors remain responsible
          for roster choices.
        </p>
      </footer>
    </div>
  );
}
