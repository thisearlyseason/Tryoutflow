import { AccountDeletionRequest } from '@/modules/identity/ui/account-deletion-request';
import type { Metadata } from 'next';
import Link from 'next/link';
import { marketingMetadata } from '@/modules/marketing/content/metadata';
export const metadata: Metadata = marketingMetadata({
  path: '/delete-account',
  title: 'Request account deletion | TryoutFlow',
  description:
    'Request deletion of your TryoutFlow account or personal data from GameDay Technologies.',
});
export default function DeleteAccountPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <p className="eyebrow">GameDay Technologies</p>
      <h1 className="mt-4 text-4xl font-black">Request TryoutFlow account deletion</h1>
      <p className="mt-6 text-lg leading-8">
        You can request deletion of your TryoutFlow account and associated personal information
        using the form below after signing in, or by contacting our monitored support inbox.
        Submitting a request does not immediately delete your account.
      </p>
      <p className="mt-4 leading-7">
        GameDay Technologies will complete a verified account-deletion request within seven days and
        confirm completion by email. If we need information to verify your identity, we will explain
        what is needed. Never send us your password.
      </p>
      <AccountDeletionRequest />
      <h2 className="mt-8 text-2xl font-bold">Request help by email</h2>
      <ol className="mt-6 list-decimal space-y-4 pl-6 leading-7">
        <li>
          Email{' '}
          <a
            className="underline break-all"
            href="mailto:gamedaysportstech@gmail.com?subject=TryoutFlow%20account%20deletion%20request"
          >
            gamedaysportstech@gmail.com
          </a>{' '}
          from your account email with the subject “TryoutFlow account deletion request.”
        </li>
        <li>
          Identify the account and organization, and say whether you want to delete the account,
          particular personal data, or both. Do not include passwords or sensitive athlete records.
        </li>
        <li>
          We will verify the request and explain which records can be removed, which are controlled
          by your organization, and any records that must be retained. A request is complete only
          when we confirm the outcome.
        </li>
      </ol>
      <h2 className="mt-8 text-2xl font-bold">Organization and athlete records</h2>
      <p className="mt-3 leading-7">
        Removing a staff account does not automatically erase an organization’s athlete
        registrations, evaluations, or rosters belonging to other people. If you are the sole owner
        of a shared organization, we will arrange an agreed transfer to an eligible existing member
        before removing your access. We will not silently appoint a new owner. If no member remains,
        we will explain and confirm closure of the organization and deletion of its records.
        Guardians and athletes can request help with records held by their sports organization
        without having a TryoutFlow account.
      </p>
      <h2 className="mt-8 text-2xl font-bold">Subscriptions and retained records</h2>
      <p className="mt-3 leading-7">
        Store subscriptions must be cancelled separately through Apple or Google; use the
        subscription links on our support page. We will coordinate cancellation of web billing when
        handling your request. You do not need to wait for a paid subscription to expire to request
        deletion. If a specific record must legally be retained, we will explain what is retained
        and why. The seven-day account-deletion commitment is not a promise that every backup copy
        expires within seven days; backup handling will be explained during fulfillment.
      </p>
      <div className="mt-6 flex flex-wrap gap-5">
        <Link className="underline" href="/support">
          Support and subscription links
        </Link>
        <Link className="underline" href="/privacy">
          Privacy information
        </Link>
      </div>
    </article>
  );
}
