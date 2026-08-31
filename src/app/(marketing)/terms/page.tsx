import type { Metadata } from 'next';

import { marketingMetadata } from '../../../modules/marketing/content/metadata';
import { LegalDraftStatus } from '../../../modules/marketing/ui/legal-draft-status';

export const metadata: Metadata = marketingMetadata({
  path: '/terms',
  title: 'Terms Draft | TryoutFlow',
  description:
    'Review the prelaunch TryoutFlow terms draft and its unresolved legal approval items.',
});

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-[var(--color-primary)]">
        Terms review copy · August 30, 2026
      </p>
      <h1 className="mt-4 text-[clamp(2.75rem,7vw,5.5rem)] font-black leading-[0.94] tracking-[-0.055em]">
        Terms for using TryoutFlow
      </h1>
      <p className="mt-6 max-w-3xl text-lg leading-8 text-[var(--color-text-muted)]">
        This draft describes the intended service relationship among TryoutFlow, subscribing sports
        organizations, authorized staff, and public registrants.
      </p>
      <LegalDraftStatus />

      <div className="mt-12 grid gap-x-12 gap-y-10 md:grid-cols-2 [&_h2]:text-2xl [&_h2]:font-black [&_p]:mt-3 [&_p]:leading-7 [&_p]:text-[var(--color-text-muted)] [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ul]:text-[var(--color-text-muted)]">
        <section>
          <h2>Organizations and authorized users</h2>
          <p>
            A subscribing organization must be legally able to enter the agreement and appoint an
            owner. The organization is responsible for its staff accounts, role assignments,
            evaluator scopes, registration instructions, lawful authority over submitted
            information, and activity performed by its authorized users. Credentials may not be
            shared.
          </p>
        </section>
        <section>
          <h2>Guardians and public registration</h2>
          <p>
            A guardian or authorized adult submitting a registration must provide accurate
            information and have authority to submit it for the athlete. Registration does not
            guarantee evaluation, placement, selection, or participation. The organization—not
            TryoutFlow—sets eligibility, tryout rules, consent requirements, and roster outcomes.
          </p>
        </section>
        <section>
          <h2>The service</h2>
          <p>
            TryoutFlow is intended to support tryout setup, registration, check-in, evaluator
            assignments, scoring, rankings, roster work, communications, reporting, billing, and
            confirmed exports. Features may change through a documented update process. Any
            production availability commitment, maintenance notice, support response target, or
            service credit requires an approved commercial agreement.
          </p>
        </section>
        <section>
          <h2>Human roster decisions</h2>
          <p>
            Scores, aggregates, filters, comparisons, and completion indicators are decision-support
            tools. TryoutFlow does not make athlete selections. The organization and its directors
            remain solely responsible for evaluation methods, fairness, accommodations, eligibility,
            roster decisions, and communications.
          </p>
        </section>
        <section>
          <h2>Acceptable use</h2>
          <ul>
            <li>Do not access another organization’s data or bypass roles and assignments.</li>
            <li>Do not upload unlawful, excessive, harmful, or unrelated sensitive information.</li>
            <li>Do not interfere with security, availability, rate limits, or other users.</li>
            <li>
              Do not use the service to discriminate unlawfully, harass, surveil, or make solely
              automated decisions about athletes.
            </li>
          </ul>
        </section>
        <section>
          <h2>Subscription and payment</h2>
          <p>
            Published plan amounts are in Canadian dollars per month unless stated otherwise. Final
            billing cycle, tax treatment, trial rules, renewal, price-change notice, cancellation
            timing, refunds, payment failure, and restoration terms must be approved before
            accepting production subscriptions. A checkout return does not itself activate access;
            verified provider state is authoritative.
          </p>
        </section>
        <section>
          <h2>Organization data and permitted use</h2>
          <p>
            The organization retains its rights in information it submits. It would grant TryoutFlow
            only the limited rights needed to host, secure, process, support, and transmit that
            information to provide the service and meet legal obligations. Export formats,
            account-closure access, deletion timing, anonymized analytics, and feedback rights
            remain subject to the approved agreement and privacy notice.
          </p>
        </section>
        <section>
          <h2>Privacy and minor-athlete information</h2>
          <p>
            Use of the service is subject to the approved privacy notice and data-processing terms.
            Organizations must minimize collection, configure optional fields responsibly, restrict
            staff access, respond to guardian and athlete rights, and obtain any notice or consent
            required for minor-athlete information.
          </p>
        </section>
        <section>
          <h2>Communications and exports</h2>
          <p>
            Roster decisions, message delivery, and external export status are separate. The
            organization must preview recipients and content, confirm bulk sends, and verify
            exported records. Provider submission does not guarantee delivery. The team-management
            integration remains a labeled demo/mock unless a documented authenticated production
            provider is separately approved.
          </p>
        </section>
        <section>
          <h2>Suspension and termination</h2>
          <p>
            Access may need to be limited for security, unlawful use, non-payment, or material
            breach, with notice and cure rights where appropriate. The final agreement must define
            suspension authority, owner notice, data export, retention, deletion, audit
            preservation, subscription termination, and the provisions that survive.
          </p>
        </section>
        <section>
          <h2>Disclaimers and liability</h2>
          <p>
            The final warranty disclaimer, liability cap, excluded damages, indemnities, insurance
            expectations, statutory-right exceptions, and allocation for athlete injury,
            eligibility, discrimination, or roster disputes are unresolved. No placeholder
            limitation is operative until reviewed for the organization’s and TryoutFlow’s
            jurisdictions.
          </p>
        </section>
        <section>
          <h2>Law, disputes, and contact</h2>
          <p>
            Governing law, venue, dispute escalation, notice addresses, assignment, force majeure,
            severability, waiver, and entire-agreement terms remain unresolved.{' '}
            <strong className="text-[var(--color-text)]">
              Support contact: to be confirmed before launch.
            </strong>{' '}
            The approved version must identify a monitored support channel and legal-notice address.
          </p>
        </section>
      </div>
    </article>
  );
}
