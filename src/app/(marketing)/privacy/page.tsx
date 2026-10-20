import type { Metadata } from 'next';
import Link from 'next/link';
import { marketingMetadata } from '../../../modules/marketing/content/metadata';

export const metadata: Metadata = marketingMetadata({
  path: '/privacy',
  title: 'Privacy | TryoutFlow',
  description:
    'How GameDay Technologies handles information in TryoutFlow and how to contact support about your data.',
});

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <p className="eyebrow">Updated September 28, 2026</p>
      <h1 className="mt-4 text-4xl font-black">Privacy at TryoutFlow</h1>
      <p className="mt-6 text-lg leading-8">
        TryoutFlow is operated by GameDay Technologies. For privacy, access, correction, or deletion
        requests, contact our monitored email at{' '}
        <a className="underline break-all" href="mailto:gamedaysportstech@gmail.com">
          gamedaysportstech@gmail.com
        </a>
        .
      </p>
      <div className="mt-10 grid gap-8 [&_h2]:text-2xl [&_h2]:font-bold [&_p]:mt-3 [&_p]:leading-7 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        <section>
          <h2>Information the service handles</h2>
          <ul>
            <li>
              Account email, authentication credentials handled by our authentication provider,
              profile name, organization membership, roles, and invitations.
            </li>
            <li>
              Athlete and guardian registration information, contact details, waivers, and
              organization-configured registration fields.
            </li>
            <li>
              Tryout schedules, attendance, athlete numbers, evaluator assignments, scores, notes,
              rankings, roster decisions, scouting and performance records, and reports.
            </li>
            <li>
              Messages, delivery events, exports, support correspondence, and security and audit
              records.
            </li>
            <li>
              Subscription and purchase identifiers, products, status, and entitlement records.
              Payment details are processed by Stripe for web purchases and Apple or Google for
              native purchases; the app does not receive your full payment-card number.
            </li>
          </ul>
        </section>
        <section>
          <h2>Why information is used</h2>
          <p>
            We process information to run accounts and organization workspaces, register and
            evaluate athletes, support staff decisions, communicate with participants, generate
            reports and exports, reconcile purchases, prevent abuse, troubleshoot problems, and
            respond to support requests. Sports organizations decide what registration information
            to collect and which authorized staff may access their records.
          </p>
        </section>
        <section>
          <h2>Who receives information</h2>
          <p>
            Authorized organization members receive information according to their roles and
            assignments. Organizations may send messages or export records to recipients they
            select. Hosting uses Vercel; database, authentication, and storage use Supabase;
            transactional email uses Resend; web billing uses Stripe; native billing integrates
            RevenueCat with Apple and Google. These providers process information needed for their
            functions. RevenueCat receives an account identifier and purchase information to
            reconcile access across devices. Disclosure may also be necessary to comply with law or
            protect the service.
          </p>
        </section>
        <section>
          <h2>Minor athletes</h2>
          <p>
            Sports organizations may keep records about minor athletes. Registration is designed for
            a guardian or authorized adult aged 18 or older; account holders must be aged 18 or
            older. An athlete does not need a separate account. The collecting organization is
            responsible for its notices, permissions, registration fields, and staff access. Contact
            that organization about athlete records or roster decisions. GameDay Technologies can
            help route a privacy request.
          </p>
        </section>
        <section>
          <h2>Device storage and security</h2>
          <p>
            The website uses authentication cookies and browser storage. Offline evaluation features
            can store assigned evaluation information on a device for later synchronization. The
            native app stores session credentials in secure device storage and purchase-attempt
            identifiers to recover interrupted purchases. Access controls, database row-level
            policies, encrypted connections, and authenticated provider callbacks help protect
            information. Shared-device users should sign out after use.
          </p>
        </section>
        <section>
          <h2>Retention and deletion</h2>
          <p>
            Account, organization, evaluation, billing, and audit records have different purposes.
            Ending a subscription or uninstalling the app does not delete account or organization
            records. We have not adopted a single fixed retention period for all record categories
            and do not promise immediate removal from backups. We complete verified account-deletion
            requests within seven days and confirm completion by email. We review ownership and
            organization-controlled records, arrange any agreed ownership transfer, and explain any
            specific legal retention requirement. Backup handling is explained separately; the
            seven-day commitment does not mean every backup expires within seven days.
          </p>
          <p>
            <Link className="underline" href="/delete-account">
              Request account or personal-data deletion
            </Link>
            . Cancel Apple or Google subscriptions through the relevant store. We coordinate web
            billing cancellation when handling your request. You can request deletion before a
            subscription expires.
          </p>
        </section>
        <section>
          <h2>Access, correction, and international processing</h2>
          <p>
            Contact your sports organization for access to or correction of the athlete information
            it controls. Contact GameDay Technologies for account information or help with a
            request. We may need to verify your identity and authority before disclosing or changing
            records. Service providers may process data outside your province or country.
            Canadian-only data residency is not promised.
          </p>
        </section>
        <section>
          <h2>Changes and contact</h2>
          <p>
            This page describes the current implementation, including native billing integrations
            being prepared for launch. We update it as the service changes. Questions can be sent to
            GameDay Technologies at{' '}
            <a className="underline break-all" href="mailto:gamedaysportstech@gmail.com">
              gamedaysportstech@gmail.com
            </a>
            . Do not include passwords, payment-card numbers, or unnecessary athlete information.
          </p>
        </section>
      </div>
    </article>
  );
}
