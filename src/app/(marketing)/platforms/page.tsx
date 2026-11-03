import Link from 'next/link';
import { marketingMetadata } from '@/modules/marketing/content/metadata';
export const metadata = marketingMetadata({
  path: '/platforms',
  title: 'TryoutFlow on Web, iOS & Android',
  description:
    'Use TryoutFlow in your browser. Learn about mobile workspace access, account requirements, subscriptions and platform availability.',
});
export default function PlatformsPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <p className="eyebrow">Web and mobile</p>
      <h1 className="mt-4 text-4xl font-black">Choose how you use TryoutFlow</h1>
      <p className="mt-6 text-lg leading-8">
        TryoutFlow helps teams, clubs and associations organize sports tryouts, evaluate athletes
        and review rosters. Your organization controls access to its workspace.
      </p>
      <h2 className="mt-8 text-2xl font-bold">Start in your browser</h2>
      <p className="mt-3 leading-7">
        Use the website on a phone, tablet or computer for registration, check-in, assigned
        evaluations, rankings and roster work. Access depends on your staff role and plan. Coaches
        make the final selection decisions.
      </p>
      <h2 className="mt-8 text-2xl font-bold">iOS and Android workspace access</h2>
      <p className="mt-3 leading-7">
        Mobile workspace builds connect to the same organization account and include store
        subscription management. Features depend on your installed version. For current installation
        or testing availability, contact support. You can use the website while arranging mobile
        access.
      </p>
      <h2 className="mt-8 text-2xl font-bold">Do parents need to download an app?</h2>
      <p className="mt-3 leading-7">
        No. Start with the registration link supplied by the organization running the tryout. Ask
        that organization about schedules, registration details and selection decisions.
      </p>
      <h2 className="mt-8 text-2xl font-bold">Can I work without an internet connection?</h2>
      <p className="mt-3 leading-7">
        Plan for an internet connection to sign in, load your workspace and synchronize results.
        Evaluation screens show draft and sync status; confirm that scores have synchronized before
        leaving a device. Do not assume the whole app works offline.
      </p>
      <h2 className="mt-8 text-2xl font-bold">Where do I manage my subscription?</h2>
      <p className="mt-3 leading-7">
        Manage web purchases in organization billing. Manage Apple or Google Play purchases through
        the store used for payment. Store prices and availability can vary by region. Deleting the
        app does not cancel a subscription.
      </p>
      <nav aria-label="Get started" className="mt-8 flex flex-wrap gap-5">
        <Link prefetch={false} className="underline" href="/sign-up">
          Create an account
        </Link>
        <Link prefetch={false} className="underline" href="/demo">
          Explore the demo
        </Link>
        <Link prefetch={false} className="underline" href="/pricing">
          Compare plans
        </Link>
        <Link prefetch={false} className="underline" href="/support">
          Contact support
        </Link>
        <Link prefetch={false} className="underline" href="/how-to">
          Read setup guides
        </Link>
      </nav>
    </article>
  );
}
