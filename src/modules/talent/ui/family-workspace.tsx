import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  MessageSquareText,
  Quote,
  ShieldCheck,
  Sparkles,
  Trophy,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { CorrectionForm, OfferResponse } from './participant-forms';
import { PrintReport } from './report-actions';

export type FamilyPerson = {
  organization_id: string;
  athlete_id: string;
  organization: string;
  name: string;
  birth_date: string | null;
  profile: {
    preferred_name: string;
    sport: string;
    primary_position: string;
    current_team: string;
    competitive_level: string;
  } | null;
  feedback: {
    title: string;
    body: string;
    strengths: string;
    development_areas: string;
    recommendation: string;
    kind: string;
    due_on: string | null;
    video_url: string | null;
  }[];
  registrations: { tryout: string; status: string }[];
  notices: { title: string; body: string; category: string; updated_at: string }[];
  fees: {
    description: string;
    currency: string;
    amount_cents: number;
    paid_cents: number;
    refunded_cents: number;
    waived_cents: number;
    due_on: string | null;
  }[];
  corrections: { request_text: string; status: string; response: string }[];
};
export type FamilySession = {
  organization_id: string;
  athlete_id: string;
  event: string;
  session: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  group: string | null;
  checked_in: boolean;
};
export type FamilyOffer = {
  organization_id: string;
  scenario_id: string;
  athlete_id: string;
  team: string;
  role: string;
  response: string;
  due_on: string | null;
};
export type FamilyRegistration = {
  organization_id: string;
  athlete_id: string;
  name: string;
  slug: string;
};

function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <h3 className="family-section-title">
      <span className="brand-icon">
        <Icon size={20} aria-hidden="true" />
      </span>
      {children}
    </h3>
  );
}

export function FamilyWorkspace({
  people,
  schedule,
  offers,
  registrationOptions,
}: {
  people: FamilyPerson[];
  schedule: FamilySession[];
  offers: FamilyOffer[];
  registrationOptions: FamilyRegistration[];
}) {
  return (
    <main
      className="talent-stack talent-report participant-content family-workspace"
      id="main-content"
    >
      <header className="talent-toolbar family-hero">
        <div>
          <p className="eyebrow">
            <Sparkles size={15} aria-hidden="true" />
            Your family workspace
          </p>
          <h1>Athlete and family portal</h1>
          <p>Your athlete’s next chapter, all in one place.</p>
        </div>
        <div className="family-invite-actions">
          <Link
            className="button-secondary"
            href="/how-to?audience=parents"
            aria-label="How to use the family portal"
            prefetch={false}
          >
            Family guide
          </Link>
          <PrintReport />
        </div>
      </header>
      <div className="family-overview" aria-label="Family summary">
        <div>
          <UsersRound aria-hidden="true" />
          <strong>{people.length}</strong>
          <span>Linked athletes</span>
        </div>
        <div>
          <CalendarDays aria-hidden="true" />
          <strong>
            {
              schedule.filter((s) =>
                people.some(
                  (p) => p.organization_id === s.organization_id && p.athlete_id === s.athlete_id,
                ),
              ).length
            }
          </strong>
          <span>Sessions</span>
        </div>
        <div>
          <MessageSquareText aria-hidden="true" />
          <strong>{people.reduce((n, p) => n + p.feedback.length, 0)}</strong>
          <span>Shared feedback</span>
        </div>
      </div>
      {!people.length ? (
        <section className="talent-card family-empty">
          <UsersRound size={40} aria-hidden="true" />
          <h2>No athletes linked yet</h2>
          <p>
            Open your coach’s family invitation to connect your athlete, or ask them to link your
            verified email.
          </p>
          <div className="family-connection-steps">
            <span>01 · Open invitation</span>
            <span>02 · Verify your email</span>
            <span>03 · Accept & connect</span>
          </div>
        </section>
      ) : null}
      {people.map((p) => {
        const sessions = schedule.filter(
          (s) => s.organization_id === p.organization_id && s.athlete_id === p.athlete_id,
        );
        const athleteOffers = offers.filter(
          (o) => o.organization_id === p.organization_id && o.athlete_id === p.athlete_id,
        );
        const options = registrationOptions.filter(
          (o) => o.organization_id === p.organization_id && o.athlete_id === p.athlete_id,
        );
        const sport = [
          p.profile?.sport,
          p.profile?.primary_position,
          p.profile?.current_team,
        ].filter((v) => v?.trim());
        return (
          <section
            className="talent-stack family-athlete"
            key={`${p.organization_id}:${p.athlete_id}`}
          >
            <header className="family-athlete-header">
              <span className="family-athlete-avatar" aria-hidden="true">
                {p.name
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((n) => n[0])
                  .join('')}
              </span>
              <div>
                <p className="eyebrow">{p.organization}</p>
                <h2>{p.name}</h2>
                {sport.length ? (
                  <p className="family-sport-tags">
                    {sport.map((s, i) => (
                      <span key={i}>{s}</span>
                    ))}
                  </p>
                ) : null}
                <details className="family-profile-details">
                  <summary>Athlete details</summary>
                  <p>Birth date: {p.birth_date || 'Not provided'}</p>
                </details>
              </div>
              <span className="family-access-pill">
                <ShieldCheck size={15} aria-hidden="true" />
                Family access
              </span>
            </header>
            <div className="talent-grid family-event-grid">
              <section className="talent-card">
                <SectionTitle icon={ClipboardCheck}>Registrations</SectionTitle>
                {p.registrations.length ? (
                  p.registrations.map((r, i) => (
                    <div className="family-record-row" key={i}>
                      <strong>{r.tryout}</strong>
                      <span className="family-state">{r.status.replaceAll('_', ' ')}</span>
                    </div>
                  ))
                ) : (
                  <p className="family-muted">No registrations yet.</p>
                )}
              </section>
              <section className="talent-card">
                <SectionTitle icon={MessageSquareText}>Event updates</SectionTitle>
                {p.notices.length ? (
                  p.notices.map((n, i) => (
                    <article className="family-notice" key={i}>
                      <span className="eyebrow">{n.category}</span>
                      <h4>{n.title}</h4>
                      <p>{n.body}</p>
                      <time dateTime={n.updated_at}>{n.updated_at.slice(0, 10)}</time>
                    </article>
                  ))
                ) : (
                  <p className="family-muted">No published updates yet.</p>
                )}
              </section>
            </div>
            <section className="talent-card family-schedule">
              <SectionTitle icon={CalendarDays}>Session schedule</SectionTitle>
              {sessions.length ? (
                sessions.map((s, i) => (
                  <article className="family-session" key={i}>
                    <time className="family-date" dateTime={s.starts_at}>
                      <span>
                        {new Date(s.starts_at).toLocaleDateString('en-CA', {
                          timeZone: s.timezone,
                          month: 'short',
                        })}
                      </span>
                      <strong>
                        {new Date(s.starts_at).toLocaleDateString('en-CA', {
                          timeZone: s.timezone,
                          day: 'numeric',
                        })}
                      </strong>
                      <small>
                        {new Date(s.starts_at).toLocaleDateString('en-CA', {
                          timeZone: s.timezone,
                          year: 'numeric',
                        })}
                      </small>
                    </time>
                    <div>
                      <span className="family-muted">{s.event}</span>
                      <h4>{s.session}</h4>
                      <p>
                        {new Date(s.starts_at).toLocaleTimeString('en-CA', {
                          timeZone: s.timezone,
                          timeStyle: 'short',
                        })}{' '}
                        –{' '}
                        {new Date(s.ends_at).toLocaleTimeString('en-CA', {
                          timeZone: s.timezone,
                          timeStyle: 'short',
                        })}{' '}
                        · {s.timezone}
                      </p>
                      <p>{s.group || 'Group not assigned'}</p>
                    </div>
                    <span className="family-state">
                      {s.checked_in ? (
                        <>
                          <CheckCircle2 size={15} aria-hidden="true" />
                          Checked in
                        </>
                      ) : (
                        'Check in with event staff'
                      )}
                    </span>
                  </article>
                ))
              ) : (
                <p className="family-muted">No sessions scheduled.</p>
              )}
              <p className="family-footnote">
                Check event updates for arrival and equipment instructions.
              </p>
            </section>
            {athleteOffers.length ? (
              <section className="talent-stack">
                <SectionTitle icon={Trophy}>Offers and next steps</SectionTitle>
                {athleteOffers.map((o) => (
                  <article className="talent-card family-offer" key={o.scenario_id}>
                    <span className="eyebrow">Your next chapter</span>
                    <h4>{o.team}</h4>
                    <p>
                      {o.role} · {o.response} · due {o.due_on || 'not specified'}
                    </p>
                    {o.response === 'pending' &&
                    (!o.due_on || o.due_on >= new Date().toISOString().slice(0, 10)) ? (
                      <OfferResponse
                        organizationId={o.organization_id}
                        scenarioId={o.scenario_id}
                        athleteId={p.athlete_id}
                      />
                    ) : null}
                  </article>
                ))}
              </section>
            ) : null}
            <section className="talent-stack family-feedback">
              <SectionTitle icon={Quote}>Approved feedback and development</SectionTitle>
              {p.feedback.length ? (
                p.feedback.map((f, i) => (
                  <article className="talent-card family-feedback-card" key={i}>
                    <p className="eyebrow">Shared by your team</p>
                    <h4>{f.title}</h4>
                    {f.body ? <p className="family-feedback-body">{f.body}</p> : null}
                    <div className="family-feedback-grid">
                      {f.strengths ? (
                        <div>
                          <strong>Strengths</strong>
                          <p>{f.strengths}</p>
                        </div>
                      ) : null}
                      {f.development_areas ? (
                        <div>
                          <strong>Development focus</strong>
                          <p>{f.development_areas}</p>
                        </div>
                      ) : null}
                      {f.recommendation ? (
                        <div>
                          <strong>Next steps</strong>
                          <p>{f.recommendation}</p>
                        </div>
                      ) : null}
                    </div>
                    {f.due_on ? <p className="family-footnote">Target: {f.due_on}</p> : null}
                    {f.video_url ? (
                      <a
                        className="button-secondary"
                        href={f.video_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View video evidence
                      </a>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="family-muted family-empty-line">
                  Your coach’s approved feedback will appear here.
                </p>
              )}
            </section>
            {p.fees.length ? (
              <section className="talent-stack">
                <SectionTitle icon={WalletCards}>Event fees</SectionTitle>
                <div className="talent-grid">
                  {p.fees.map((f, i) => (
                    <article className="talent-card family-fee" key={i}>
                      <h4>{f.description}</h4>
                      <span className="family-muted">Recorded balance</span>
                      <strong className="family-balance">
                        {f.currency}{' '}
                        {(
                          (f.amount_cents - f.paid_cents + f.refunded_cents - f.waived_cents) /
                          100
                        ).toFixed(2)}
                      </strong>
                      <details>
                        <summary>View fee breakdown</summary>
                        <p>
                          {f.currency} {(f.amount_cents / 100).toFixed(2)} recorded ·{' '}
                          {(f.paid_cents / 100).toFixed(2)} paid ·{' '}
                          {(f.refunded_cents / 100).toFixed(2)} refunded ·{' '}
                          {(f.waived_cents / 100).toFixed(2)} waived
                        </p>
                      </details>
                      <p className="family-footnote">
                        Due {f.due_on || 'not specified'}. Contact your organizer for payment
                        instructions.
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            ) : (
              <p className="family-footnote">
                <WalletCards size={16} aria-hidden="true" />
                No event fees recorded.
              </p>
            )}
            {options.length ? (
              <details className="talent-editor family-more">
                <summary>Register for another event</summary>
                <p>Choose an event, then review its form and consent.</p>
                {options.map((o) => (
                  <p key={o.slug}>
                    <Link
                      className="button-secondary"
                      href={`/register/${o.slug}?athlete=${p.athlete_id}`}
                      prefetch={false}
                    >
                      {o.name}
                    </Link>
                  </p>
                ))}
              </details>
            ) : null}
            <details className="talent-editor family-more">
              <summary>Corrections and requests</summary>
              {p.corrections.map((r, i) => (
                <div className="family-notice" key={i}>
                  <p>{r.request_text}</p>
                  <span className="family-state">{r.status}</span>
                  <p>{r.response || 'Awaiting organizer review'}</p>
                </div>
              ))}
              <CorrectionForm organizationId={p.organization_id} athleteId={p.athlete_id} />
            </details>
          </section>
        );
      })}
      <p className="family-access-note">
        <ShieldCheck size={17} aria-hidden="true" />
        Family access · Approved athlete information only
      </p>
    </main>
  );
}
