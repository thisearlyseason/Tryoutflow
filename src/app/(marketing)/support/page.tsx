import type { Metadata } from 'next';
import Link from 'next/link';
import { marketingMetadata } from '@/modules/marketing/content/metadata';
export const metadata: Metadata = marketingMetadata({
  path: '/support',
  title: 'Support | TryoutFlow',
  description: 'Contact GameDay Technologies for TryoutFlow account, billing, and privacy support.',
});
export default function SupportPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <p className="eyebrow">Gameday Sports</p>
      <h1 className="mt-4 text-4xl font-black">TryoutFlow support</h1>
      <p className="mt-6 text-lg leading-8">
        For help with your web, iOS, or Android account, email our monitored support inbox:{' '}
        <a className="underline break-all" href="mailto:gamedaysportstech@gmail.com">
          gamedaysportstech@gmail.com
        </a>
        .
      </p>
      <p className="mt-4 leading-7">
        Include your account email, organization name, device, and a short description of the
        problem. Do not send your password, full payment-card details, or unnecessary athlete
        information.
      </p>
      <h2 className="mt-8 text-2xl font-bold">Tryout and team questions</h2>
      <p className="mt-3 leading-7">
        Contact the sports organization running your tryout about registration, schedules,
        evaluations, or roster decisions.
      </p>
      <h2 className="mt-8 text-2xl font-bold">Accounts and subscriptions</h2>
      <p className="mt-3 leading-7">
        The native app is an account and subscription companion. Coaching workflows are available on
        the website. Manage web subscriptions from your organization billing page; manage native
        subscriptions in the store used to purchase them. Deleting an account or uninstalling the
        app does not cancel a subscription.
      </p>
      <nav aria-label="Support resources" className="mt-6 flex flex-wrap gap-5">
        <Link prefetch={false} className="underline" href="/how-to">
          Web user guide
        </Link>
        <Link prefetch={false} className="underline" href="/forgot-password">
          Reset password
        </Link>
        <Link prefetch={false} className="underline" href="/delete-account">
          Request account deletion
        </Link>
        <Link prefetch={false} className="underline" href="/privacy">
          Privacy
        </Link>
        <a className="underline" href="https://apps.apple.com/account/subscriptions">
          Apple subscriptions
        </a>
        <a className="underline" href="https://play.google.com/store/account/subscriptions">
          Google Play subscriptions
        </a>
      </nav>
    </article>
  );
}
