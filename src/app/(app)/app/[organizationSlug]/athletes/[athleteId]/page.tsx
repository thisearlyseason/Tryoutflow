import Image from 'next/image';
import { PortraitForm, ContactForm } from '@/modules/talent/ui/athlete-media-forms';
import { EvaluationHistory } from '@/modules/talent/ui/evaluation-history';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { requireCapability } from '@/modules/organizations/application/require-capability';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadTalent } from '@/modules/talent/application/workspace';
import { EditRecord } from '@/modules/talent/ui/record-form';
import {
  profileDefaults,
  profileFields,
  pickValues,
  recordDefaults,
  recordFields,
  resultDefaults,
} from '@/modules/talent/ui/fields';
import { ScoutingCards } from '@/modules/talent/ui/scouting-cards';
import { PerformanceView, resultFields } from '@/modules/talent/ui/performance-view';
import { IdentityForm } from '@/modules/talent/ui/identity-form';

export default async function AthleteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string; athleteId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { organizationSlug: slug, athleteId } = await params;
  const selected = (await searchParams).tab ?? 'overview';
  const access = await requireCurrentOrganization(slug);
  const grant = await access.client.rpc('can_use_talent', {
    p_organization_id: access.organization.id,
  });
  if (!grant.data) {
    if (
      !requireCapability(access.authorization, 'athlete:read', {
        organizationId: access.organization.id,
        athleteId,
      }).ok
    )
      notFound();
    const basic = await access.client
      .from('athletes')
      .select('given_name,family_name,birth_date')
      .eq('organization_id', access.organization.id)
      .eq('id', athleteId)
      .maybeSingle();
    if (!basic.data) notFound();
    return (
      <section className="talent-card">
        <h1>
          {basic.data.given_name} {basic.data.family_name}
        </h1>
        <p>Birth date: {basic.data.birth_date || 'Not provided'}</p>
        <p>Use your assigned tryout workspace for evaluation and registration information.</p>
      </section>
    );
  }
  const w = await loadTalent(slug, athleteId);
  const c = w.current;
  const athlete = await c.client
    .from('athletes')
    .select('id,given_name,family_name,birth_date,created_at,updated_at')
    .eq('organization_id', c.organization.id)
    .eq('id', athleteId)
    .maybeSingle();
  if (!athlete.data) notFound();
  const a = athlete.data;
  const profile = w.profiles.find((p) => p.athlete_id === athleteId);
  const manager = ['owner', 'administrator'].includes(c.authorization.organizationRole);
  const registrations = await c.client
    .from('tryout_registrations')
    .select('id,tryout_id,status,responses,created_at')
    .eq('organization_id', c.organization.id)
    .eq('athlete_id', athleteId)
    .order('created_at', { ascending: false })
    .limit(200);
  const contacts = manager
    ? await c.client
        .from('athlete_guardians')
        .select('relationship_label,guardians(id,name,email,phone,updated_at)')
        .eq('organization_id', c.organization.id)
        .eq('athlete_id', athleteId)
    : null;
  const portraitResult = await c.client.rpc('read_athlete_portrait', {
    p_organization_id: c.organization.id,
    p_athlete_id: athleteId,
  });
  const portrait = portraitResult.data as { base64: string; version: number } | null;
  const athleteOptions = [{ value: athleteId, label: `${a.given_name} ${a.family_name}` }];
  const people = w.people.map((e) => ({ value: e.user_id, label: e.display_name }));
  const tabs = ['overview', 'stats', 'evaluations', 'video', 'history', 'development', 'contacts'];
  const kind =
    selected === 'evaluations'
      ? 'report'
      : selected === 'video'
        ? 'video'
        : selected === 'development'
          ? 'goal'
          : null;
  return (
    <section className="talent-stack">
      <Link prefetch={false} href={`/app/${slug}/athletes`}>
        ← All athletes
      </Link>
      <header className="talent-card talent-identity">
        <span className="athlete-avatar">
          {portrait ? (
            <Image
              src={`data:image/webp;base64,${portrait.base64.replaceAll(/\s/g, '')}`}
              alt="Athlete portrait"
              width={64}
              height={64}
              unoptimized
              style={{ borderRadius: 32, objectFit: 'cover' }}
            />
          ) : (
            <>
              {a.given_name[0]}
              {a.family_name[0]}
            </>
          )}
        </span>
        <div>
          <p className="eyebrow">Athlete dossier</p>
          <h1>
            {profile?.preferred_name || a.given_name} {a.family_name}
          </h1>
          <p className="talent-meta">
            {[profile?.primary_position, profile?.current_team, profile?.competitive_level]
              .filter(Boolean)
              .join(' · ') || 'Complete the sporting profile to begin.'}
          </p>
          <span className="talent-tag">
            {(profile?.stage ?? 'identified').replaceAll('_', ' ')}
          </span>
        </div>
      </header>
      <nav className="talent-tabs" aria-label="Athlete profile sections">
        {tabs
          .filter((t) => t !== 'contacts' || manager)
          .map((t) => (
            <Link
              prefetch={false}
              key={t}
              aria-current={selected === t ? 'page' : undefined}
              href={`?tab=${t}`}
            >
              {t[0]!.toUpperCase() + t.slice(1)}
            </Link>
          ))}
      </nav>
      {selected === 'overview' && (
        <>
          <div className="talent-stats">
            <div>
              <span>Measured trials</span>
              <strong>{w.results.length}</strong>
            </div>
            <div>
              <span>Scouting reports</span>
              <strong>{w.records.filter((r) => r.kind === 'report').length}</strong>
            </div>
            <div>
              <span>Open follow-ups</span>
              <strong>
                {
                  w.records.filter(
                    (r) => r.kind === 'task' && !['complete', 'archived'].includes(r.status),
                  ).length
                }
              </strong>
            </div>
          </div>
          <div className="talent-grid">
            <article className="talent-card">
              <h2>Sporting background</h2>
              <p>{profile?.biography || 'No sporting background recorded.'}</p>
              <dl>
                <dt>Sport</dt>
                <dd>{profile?.sport || 'Not provided'}</dd>
                <dt>Primary / other positions</dt>
                <dd>
                  {[profile?.primary_position, profile?.secondary_positions]
                    .filter(Boolean)
                    .join(' / ') || 'Not provided'}
                </dd>
                <dt>Dominant side</dt>
                <dd>{profile?.dominant_side || 'Not provided'}</dd>
                <dt>Birth date</dt>
                <dd>{a.birth_date ?? 'Not provided'}</dd>
                <dt>Hometown</dt>
                <dd>{profile?.hometown || 'Not provided'}</dd>
              </dl>
              <p>
                {profile?.tags
                  .split(',')
                  .filter(Boolean)
                  .map((t) => (
                    <span className="talent-tag" key={t}>
                      {t.trim()}
                    </span>
                  ))}
              </p>
            </article>
            <article className="talent-card talent-action-list">
              <h2>Next actions</h2>
              <p>
                <Link prefetch={false} href="?tab=stats">
                  Record a measured result →
                </Link>
              </p>
              <p>
                <Link prefetch={false} href="?tab=evaluations">
                  Add a scouting observation →
                </Link>
              </p>
              <p>
                <Link prefetch={false} href={`/app/${slug}/reports/athletes/${athleteId}`}>
                  Prepare athlete report →
                </Link>
              </p>
              <p>
                <Link
                  prefetch={false}
                  href={`/app/${slug}/scouting?kind=task&athlete=${athleteId}`}
                >
                  Assign a follow-up →
                </Link>
              </p>
            </article>
          </div>
          <EditRecord
            slug={slug}
            table="athlete_sport_profiles"
            title="Edit sporting profile"
            id={profile?.id}
            version={profile?.version ?? 0}
            initial={
              profile
                ? pickValues(profile, { ...profileDefaults, athlete_id: athleteId })
                : undefined
            }
            defaults={{ ...profileDefaults, athlete_id: athleteId }}
            fields={profileFields}
          />
          {manager && (
            <details className="talent-editor">
              <summary>Correct name or birth date</summary>
              <IdentityForm slug={slug} athlete={a} />
            </details>
          )}
        </>
      )}
      {selected === 'overview' && manager && (
        <details className="talent-editor">
          <summary>Update athlete photo</summary>
          <PortraitForm slug={slug} athleteId={athleteId} version={portrait?.version ?? 0} />
        </details>
      )}
      {selected === 'stats' && (
        <>
          <PerformanceView
            slug={slug}
            athleteId={athleteId}
            athletes={w.athletes}
            metrics={w.metrics}
            results={w.results}
          />
          <EditRecord
            slug={slug}
            table="performance_results"
            title="Record a measurement"
            defaults={{
              ...resultDefaults,
              athlete_id: athleteId,
              measured_at: new Date().toISOString(),
            }}
            fields={resultFields(
              athleteOptions,
              w.metrics,
              w.sessions.map((s) => ({ value: s.id, label: s.name })),
              true,
            )}
          />
          <details className="talent-editor">
            <summary>Correct a recorded trial</summary>
            {w.results.map((r) => (
              <EditRecord
                key={r.id}
                slug={slug}
                table="performance_results"
                id={r.id}
                version={r.version}
                title={`${w.metrics.find((m) => m.id === r.metric_id)?.name ?? 'Metric'} · ${r.measured_at.slice(0, 10)} · trial ${r.trial}`}
                defaults={resultDefaults}
                initial={pickValues(r, resultDefaults)}
                fields={resultFields(
                  athleteOptions,
                  w.metrics,
                  w.sessions.map((s) => ({ value: s.id, label: s.name })),
                  true,
                )}
              />
            ))}
          </details>
        </>
      )}
      {selected === 'evaluations' && <EvaluationHistory workspace={w} athleteId={athleteId} />}
      {kind && (
        <>
          <ScoutingCards
            reviewable={['owner', 'administrator'].includes(
              w.current.authorization.organizationRole,
            )}
            slug={slug}
            records={w.records.filter((r) => r.kind === kind)}
            athletes={athleteOptions}
            people={people}
            fixedAthlete
          />
          <EditRecord
            slug={slug}
            table="scouting_records"
            title={`Add ${kind === 'report' ? 'scouting report' : kind === 'goal' ? 'development goal' : 'video evidence'}`}
            defaults={{ ...recordDefaults, athlete_id: athleteId, kind }}
            fields={recordFields(kind, athleteOptions, people, true)}
          />
        </>
      )}
      {selected === 'history' && (
        <>
          <h2>Participation and submitted information</h2>
          {registrations.error ? (
            <p role="alert">Participation history could not load.</p>
          ) : !registrations.data?.length ? (
            <div className="talent-empty">This prospect has not registered for a tryout yet.</div>
          ) : (
            registrations.data.map((r) => (
              <article className="talent-card" key={r.id}>
                <h3>
                  <Link prefetch={false} href={`/app/${slug}/tryouts/${r.tryout_id}/overview`}>
                    {w.tryouts.find((t) => t.id === r.tryout_id)?.name ?? 'Tryout'}
                  </Link>
                </h3>
                <p>
                  {r.status} · {r.created_at.slice(0, 10)}
                </p>
                <Link
                  prefetch={false}
                  href={`/app/${slug}/tryouts/${r.tryout_id}/rankings?search=${encodeURIComponent(a.family_name)}`}
                >
                  Review evaluation evidence →
                </Link>
                {manager && (
                  <details>
                    <summary>Registration answers</summary>
                    <dl>
                      {Object.entries(
                        (r.responses &&
                        typeof r.responses === 'object' &&
                        !Array.isArray(r.responses)
                          ? r.responses
                          : {}) as Record<string, unknown>,
                      ).map(([k, v]) => (
                        <div key={k}>
                          <dt>{k.replaceAll('_', ' ')}</dt>
                          <dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
              </article>
            ))
          )}
        </>
      )}
      {selected === 'contacts' && manager && (
        <>
          <h2>Authorized contacts</h2>
          <details className="talent-editor">
            <summary>Add athlete / guardian / representative contact</summary>
            <ContactForm slug={slug} athleteId={athleteId} />
          </details>
          <p className="talent-meta">Contact details are restricted to organization managers.</p>
          {contacts?.error ? (
            <p role="alert">Contact records could not load.</p>
          ) : (
            contacts?.data?.map((r, i) => (
              <article className="talent-card" key={i}>
                <h3>{r.guardians?.name}</h3>
                <p>{r.relationship_label}</p>
                <a href={`mailto:${r.guardians?.email}`}>{r.guardians?.email}</a>
                <p>{r.guardians?.phone}</p>
                {r.guardians && (
                  <details className="talent-editor">
                    <summary>Correct contact details</summary>
                    <ContactForm
                      slug={slug}
                      athleteId={athleteId}
                      contact={{ ...r.guardians, relationship: r.relationship_label }}
                    />
                  </details>
                )}
              </article>
            ))
          )}
          {!contacts?.data?.length && (
            <div className="talent-empty">No linked contacts recorded.</div>
          )}
        </>
      )}
    </section>
  );
}
