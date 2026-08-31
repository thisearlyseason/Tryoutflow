import type { Metadata } from 'next';

import { marketingMetadata } from '../../../modules/marketing/content/metadata';
import { LegalDraftStatus } from '../../../modules/marketing/ui/legal-draft-status';

export const metadata: Metadata = marketingMetadata({
  path: '/privacy',
  title: 'Privacy Draft | TryoutFlow',
  description:
    'Review the prelaunch TryoutFlow privacy draft and its unresolved legal approval items.',
});

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-[var(--color-primary)]">
        Policy review copy · August 30, 2026
      </p>
      <h1 className="mt-4 text-[clamp(2.75rem,7vw,5.5rem)] font-black leading-[0.94] tracking-[-0.055em]">
        Privacy at TryoutFlow
      </h1>
      <p className="mt-6 max-w-3xl text-lg leading-8 text-[var(--color-text-muted)]">
        This draft explains how the planned TryoutFlow service would handle information for
        organizations, staff, guardians, and minor athletes.
      </p>
      <LegalDraftStatus />

      <div className="mt-12 grid gap-x-12 gap-y-10 md:grid-cols-2 [&_h2]:text-2xl [&_h2]:font-black [&_p]:mt-3 [&_p]:leading-7 [&_p]:text-[var(--color-text-muted)] [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ul]:text-[var(--color-text-muted)]">
        <section>
          <h2>Scope and roles</h2>
          <p>
            TryoutFlow is intended to process tryout information for the subscribing sports
            organization. The organization determines why athlete and guardian information is
            collected and who on its staff may use it. TryoutFlow acts as service provider or
            processor for that organization, while handling account, billing, security, and
            service-operation information for its own stated purposes.
          </p>
        </section>
        <section>
          <h2>Information we expect to process</h2>
          <ul>
            <li>Organization, membership, role, and account details.</li>
            <li>
              Guardian contact information and athlete registration details selected by the
              organization.
            </li>
            <li>
              Check-in status, assigned number, evaluator assignments, scores, completion state,
              notes, flags, rankings, decisions, and rosters.
            </li>
            <li>
              Message delivery, subscription, audit, security, and privacy-safe operational events.
            </li>
          </ul>
          <p>
            Organizations should collect only information needed to run the tryout. Emergency or
            eligibility fields should be optional and organization-controlled.
          </p>
        </section>
        <section>
          <h2>How information is used</h2>
          <p>
            Information is intended to publish and administer tryouts, accept registrations, check
            athletes in, support independent evaluation, calculate transparent aggregates, build
            rosters, communicate with participants, provide confirmed exports, secure accounts, bill
            organizations, and maintain an audit trail. Private evaluation content must not be used
            in third-party advertising or general product analytics.
          </p>
        </section>
        <section>
          <h2>Children and minor athletes</h2>
          <p>
            Most athlete records may concern minors. Registration is designed to be completed by a
            guardian or authorized adult; athletes do not need their own account. Organizations are
            responsible for authority to collect and use minor-athlete information, notices to
            families, and any consent required in their jurisdiction. The required age, consent,
            parental-access, and child-privacy language remains an unresolved legal-review item.
          </p>
        </section>
        <section>
          <h2>Access, sharing, and disclosure</h2>
          <p>
            Role and assignment boundaries are intended to limit access: for example, check-in staff
            should not see rankings, and evaluators should not see peer scores during live
            evaluation by default. Information may be disclosed when instructed by the subscribing
            organization, required by law, needed to protect the service, or provided to approved
            subprocessors under appropriate terms.
          </p>
        </section>
        <section>
          <h2>Service providers and subprocessors</h2>
          <p>
            Planned processor categories include cloud hosting, database/authentication and private
            storage, subscription billing, transactional email, error monitoring, and privacy-safe
            product analytics. Current technical vendors include Vercel, Supabase, Stripe, and
            Resend, but the final subprocessor list, locations, transfer terms, and change-notice
            process must be verified before production launch.
          </p>
        </section>
        <section>
          <h2>Cross-border processing and residency</h2>
          <p>
            Service providers may process information outside the organization’s province or
            country, where it may be subject to local law. Canadian-only data residency is not
            promised. Exact hosting regions, international transfer safeguards,
            customer-jurisdiction requirements, and any Canadian public-sector restrictions remain
            unresolved and require written approval.
          </p>
        </section>
        <section>
          <h2>Retention, deletion, and correction</h2>
          <p>
            Organizations need tools and procedures to export, correct, and delete information,
            subject to lawful recordkeeping and audit needs. Exact retention periods for
            registrations, scores, notes, rosters, messages, audit logs, backups, and support
            records have not been approved. Production onboarding must not begin until a retention
            schedule, deletion workflow, backup-expiry rule, and post-termination handling process
            are adopted.
          </p>
        </section>
        <section>
          <h2>Security and incidents</h2>
          <p>
            Planned safeguards include tenant isolation, row-level database policies, role-based
            authorization, private storage, encrypted transport, protected credentials, verified
            webhook signatures, audit events, and privacy-safe logs. No system is risk-free. A
            security contact, incident-response procedure, notification assessment, support-access
            policy, and breach timeline must be approved before launch.
          </p>
        </section>
        <section>
          <h2>Individual and guardian requests</h2>
          <p>
            Requests to access, correct, export, or delete information should normally be directed
            to the sports organization that collected it. TryoutFlow would assist the organization
            as required by contract and law. Identity verification, authorized-agent handling,
            appeal rights, response timelines, and direct-request routing remain subject to legal
            review.
          </p>
        </section>
        <section>
          <h2>Changes to this notice</h2>
          <p>
            An approved notice would identify its effective date and material changes. Organizations
            would receive notice through an approved channel when required. This draft has no
            effective date because it is not yet operative.
          </p>
        </section>
        <section>
          <h2>Contact and unresolved owner</h2>
          <p>
            <strong className="text-[var(--color-text)]">
              Privacy contact: to be confirmed before launch.
            </strong>{' '}
            The approved version must provide a monitored email or postal address, the accountable
            privacy role, and escalation details. Do not send athlete or guardian information to an
            unconfirmed contact.
          </p>
        </section>
      </div>
    </article>
  );
}
