import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/infrastructure/supabase/server';
import { CorrectionForm, OfferResponse } from '@/modules/talent/ui/participant-forms';
import { PrintReport } from '@/modules/talent/ui/report-actions';
type Person = {
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
export default async function Page() {
  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect('/sign-in?next=/participant');
  const { data, error } = await client.rpc('participant_workspace');
  if (error) throw new Error('Participant information could not load.');
  const offerResult = await client.rpc('participant_offers');
  if (offerResult.error) throw new Error('Offer responses could not load.');
  const offers = (offerResult.data ?? []) as {
    organization_id: string;
    scenario_id: string;
    athlete_id: string;
    team: string;
    role: string;
    response: string;
    due_on: string | null;
  }[];
  const [scheduleResult, optionResult] = await Promise.all([
    client.rpc('participant_schedule'),
    client.rpc('participant_registration_options'),
  ]);
  if (scheduleResult.error || optionResult.error)
    throw new Error('Schedule or registration options could not load.');
  const schedule = (scheduleResult.data ?? []) as {
    organization_id: string;
    athlete_id: string;
    event: string;
    session: string;
    starts_at: string;
    ends_at: string;
    timezone: string;
    group: string | null;
    checked_in: boolean;
  }[];
  const registrationOptions = (optionResult.data ?? []) as {
    organization_id: string;
    athlete_id: string;
    name: string;
    slug: string;
  }[];
  const people = (Array.isArray(data) ? data : []) as unknown as Person[];
  return (
    <main
      className="talent-stack talent-report"
      style={{ maxWidth: 1000, margin: 'auto', padding: '2rem 1rem' }}
    >
      <header className="talent-toolbar">
        <div>
          <Link href="/">TryoutFlow</Link>
          <h1>Athlete and family portal</h1>
          <p>Your linked athletes, approved feedback and event updates.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link className="button-secondary" href="/how-to?audience=parents">
            How to use the family portal
          </Link>
          <PrintReport />
        </div>
      </header>
      {!people.length && (
        <section className="talent-card">
          <h2>No athletes linked yet</h2>
          <p>
            Ask your organizer to link your verified account email to your athlete. Access is
            granted individually.
          </p>
        </section>
      )}
      {people.map((p) => (
        <section className="talent-stack" key={`${p.organization_id}:${p.athlete_id}`}>
          <header>
            <p className="eyebrow">{p.organization}</p>
            <h2>{p.name}</h2>
            <p>
              {p.profile?.sport} · {p.profile?.primary_position} · {p.profile?.current_team}
            </p>
            <p>Birth date: {p.birth_date || 'Not provided'}</p>
          </header>
          <div className="talent-grid">
            <section className="talent-card">
              <h3>Registrations</h3>
              {p.registrations.map((r, i) => (
                <p key={i}>
                  {r.tryout} · {r.status}
                </p>
              ))}
            </section>
            <section className="talent-card">
              <h3>Event updates</h3>
              {p.notices.length ? (
                p.notices.map((n, i) => (
                  <article key={i}>
                    <h4>{n.title}</h4>
                    <p>{n.body}</p>
                    <small>{n.updated_at.slice(0, 10)}</small>
                  </article>
                ))
              ) : (
                <p>No published updates.</p>
              )}
            </section>
          </div>
          <section className="talent-card">
            <h3>Session schedule</h3>
            {schedule
              .filter(
                (s) => s.organization_id === p.organization_id && s.athlete_id === p.athlete_id,
              )
              .map((s, i) => (
                <p key={i}>
                  <strong>
                    {s.event}: {s.session}
                  </strong>
                  <br />
                  {new Date(s.starts_at).toLocaleString('en-CA', {
                    timeZone: s.timezone,
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}{' '}
                  –{' '}
                  {new Date(s.ends_at).toLocaleTimeString('en-CA', {
                    timeZone: s.timezone,
                    timeStyle: 'short',
                  })}{' '}
                  ({s.timezone})<br />
                  {s.group || 'Group not assigned'} ·{' '}
                  {s.checked_in ? 'Checked in' : 'Check in with event staff'}
                </p>
              ))}
            <p>Follow published event updates for arrival and equipment instructions.</p>
          </section>
          <details className="talent-editor">
            <summary>Register for another event</summary>
            <p>
              Reuse this athlete’s name and birth date. Review current questions and consent before
              submitting; event availability is checked on the registration page.
            </p>
            {registrationOptions
              .filter(
                (o) => o.organization_id === p.organization_id && o.athlete_id === p.athlete_id,
              )
              .map((o) => (
                <p key={o.slug}>
                  <Link href={`/register/${o.slug}?athlete=${p.athlete_id}`}>{o.name}</Link>
                </p>
              ))}
          </details>
          <h3>Offers and next steps</h3>
          {offers
            .filter((o) => o.organization_id === p.organization_id && o.athlete_id === p.athlete_id)
            .map((o) => (
              <article className="talent-card" key={o.scenario_id}>
                <h4>{o.team}</h4>
                <p>
                  {o.role} · {o.response} · due {o.due_on || 'not specified'}
                </p>
                {o.response === 'pending' &&
                  (!o.due_on || o.due_on >= new Date().toISOString().slice(0, 10)) && (
                    <OfferResponse
                      organizationId={o.organization_id}
                      scenarioId={o.scenario_id}
                      athleteId={o.athlete_id}
                    />
                  )}
              </article>
            ))}
          <h3>Approved feedback and development</h3>
          {p.feedback.length ? (
            p.feedback.map((f, i) => (
              <article className="talent-card" key={i}>
                <h4>{f.title}</h4>
                <p>{f.body}</p>
                {f.strengths && (
                  <p>
                    <strong>Strengths:</strong> {f.strengths}
                  </p>
                )}
                {f.development_areas && (
                  <p>
                    <strong>Development:</strong> {f.development_areas}
                  </p>
                )}
                {f.recommendation && (
                  <p>
                    <strong>Next steps:</strong> {f.recommendation}
                  </p>
                )}
                {f.due_on && <p>Target: {f.due_on}</p>}
                {f.video_url && (
                  <a href={f.video_url} target="_blank" rel="noreferrer">
                    View video evidence
                  </a>
                )}
              </article>
            ))
          ) : (
            <p>No feedback has been approved for sharing yet.</p>
          )}
          <h3>Event fees</h3>
          {p.fees.length ? (
            p.fees.map((f, i) => (
              <article className="talent-card" key={i}>
                <h4>{f.description}</h4>
                <p>
                  {f.currency} {(f.amount_cents / 100).toFixed(2)} charged ·{' '}
                  {(f.paid_cents / 100).toFixed(2)} paid · {(f.refunded_cents / 100).toFixed(2)}{' '}
                  refunded · {(f.waived_cents / 100).toFixed(2)} waived
                </p>
                <strong>
                  Balance {f.currency}{' '}
                  {(
                    (f.amount_cents - f.paid_cents + f.refunded_cents - f.waived_cents) /
                    100
                  ).toFixed(2)}
                </strong>
                <p>
                  Due {f.due_on || 'not specified'}. Contact your organizer for payment
                  instructions.
                </p>
              </article>
            ))
          ) : (
            <p>No event fees recorded.</p>
          )}
          <details className="talent-editor">
            <summary>Corrections and requests</summary>
            {p.corrections.map((r, i) => (
              <p key={i}>
                {r.request_text}
                <br />
                {r.status}: {r.response || 'Awaiting organizer review'}
              </p>
            ))}
            <CorrectionForm organizationId={p.organization_id} athleteId={p.athlete_id} />
          </details>
        </section>
      ))}
    </main>
  );
}
