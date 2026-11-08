'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FeedbackButton } from '@/components/ui/button';

export function FamilyPortalNavigation() {
  const pathname = usePathname();
  const returnTo = pathname === '/participant/account' ? pathname : '/participant';
  const help = new URLSearchParams({ audience: 'parents', returnTo });
  return (
    <header className="family-portal-header talent-no-print">
      <Link className="family-portal-brand" href="/" prefetch={false}>
        TryoutFlow
      </Link>
      <nav aria-label="Family portal navigation" className="family-portal-navigation">
        <Link
          href="/participant"
          prefetch={false}
          aria-current={pathname === '/participant' ? 'page' : undefined}
        >
          Family portal
        </Link>
        <Link
          href="/participant/account"
          prefetch={false}
          aria-current={pathname === '/participant/account' ? 'page' : undefined}
        >
          Account
        </Link>
        <Link href={`/how-to?${help.toString()}`} aria-label="Help and guides" prefetch={false}>
          Help
        </Link>
        <form action="/auth/sign-out?returnTo=participant" method="post">
          <FeedbackButton className="button-secondary" type="submit">
            Sign out
          </FeedbackButton>
        </form>
      </nav>
    </header>
  );
}
