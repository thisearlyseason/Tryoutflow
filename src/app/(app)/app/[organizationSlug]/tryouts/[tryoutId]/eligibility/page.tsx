import { notFound } from 'next/navigation';
import { talentContext, pages } from '@/modules/talent/application/workspace';
import { EligibilityForm } from '@/modules/talent/ui/eligibility-form';
import { ageEligibility } from '@/modules/talent/domain/eligibility';
import { PrintReport } from '@/modules/talent/ui/report-actions';
export default async function Page({
  params,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
}) {
  const { organizationSlug: slug, tryoutId } = await params;
  const c = await talentContext(slug);
  if (!['owner', 'administrator'].includes(c.authorization.organizationRole)) notFound();
  const id = c.organization.id;
  const [policy, exceptions, registrations, divisions] = await Promise.all([
    c.client
      .from('event_eligibility_policies')
      .select('*')
      .eq('organization_id', id)
      .eq('tryout_id', tryoutId)
      .maybeSingle(),
    pages(
      (o) =>
        c.client
          .from('eligibility_exceptions')
          .select('*')
          .eq('organization_id', id)
          .eq('tryout_id', tryoutId)
          .order('id')
          .range(o, o + 999),
      'Eligibility reviews',
    ),
    pages(
      (o) =>
        c.client
          .from('tryout_registrations')
          .select('id,athlete_id,division_id,athletes(given_name,family_name,birth_date)')
          .eq('organization_id', id)
          .eq('tryout_id', tryoutId)
          .order('id')
          .range(o, o + 999),
      'Eligibility roster',
    ),
    c.client
      .from('tryout_divisions')
      .select('id,name,min_age,max_age')
      .eq('organization_id', id)
      .eq('tryout_id', tryoutId),
  ]);
  if (policy.error || exceptions.error || registrations.error || divisions.error)
    throw new Error('Eligibility reviews could not load.');
  const p = policy.data;
  return (
    <section className="talent-stack talent-report">
      <header className="talent-toolbar">
        <div>
          <h1>Eligibility and exceptions</h1>
          <p>
            Calculate age on an explicit competition cutoff and record a human review of exceptions.
          </p>
        </div>
        <PrintReport />
      </header>
      <p>
        This review supports the selection meeting. It does not automatically reject registrations
        or change roster decisions. Configure each division’s age range in event setup. Policy
        changes require previous exceptions to be reviewed again.
      </p>
      <EligibilityForm
        slug={slug}
        hidden={{ kind: 'policy', tryout_id: tryoutId, version: p?.version ?? 0 }}
      >
        <h2>Competition policy</h2>
        <label>
          Age cutoff date
          <input required type="date" name="cutoff_date" defaultValue={p?.cutoff_date || ''} />
        </label>
        <label>
          Competition rules and reference
          <textarea
            name="rules"
            maxLength={8000}
            defaultValue={p?.rules || ''}
            placeholder="Record the governing competition rule and any non-age requirements."
          />
        </label>
      </EligibilityForm>
      {p && (
        <>
          <section className="talent-card">
            <h2>Current competition policy</h2>
            <p>
              Age cutoff: {p.cutoff_date} · revision {p.version}
            </p>
            <p>{p.rules || 'No additional competition rules recorded.'}</p>
          </section>
          <h2>Registered athletes · policy revision {p.version}</h2>
          {registrations.data?.map((r) => {
            const d = divisions.data?.find((d) => d.id === r.division_id),
              a = r.athletes;
            const check = ageEligibility(
              a.birth_date,
              p.cutoff_date,
              d?.min_age ?? null,
              d?.max_age ?? null,
            );
            const e = exceptions.data?.find((e) => e.athlete_id === r.athlete_id);
            return (
              <article className="talent-card" key={r.id}>
                <h3>
                  {a.given_name} {a.family_name}
                </h3>
                <p>
                  {d?.name} · Age {check.age ?? 'unknown'} on {p.cutoff_date} · {check.status}
                </p>
                {e && (
                  <p>
                    <strong>
                      {e.policy_version === p.version ? e.status : 'Policy changed — review again'}
                    </strong>
                    : {e.reason}
                  </p>
                )}
                <details className="talent-editor">
                  <summary>Record eligibility review / exception</summary>
                  <EligibilityForm
                    slug={slug}
                    hidden={{
                      kind: 'exception',
                      tryout_id: tryoutId,
                      athlete_id: r.athlete_id,
                      policy_version: p.version,
                      version: e?.version ?? 0,
                    }}
                  >
                    <label>
                      Decision
                      <select name="status" defaultValue={e?.status || 'pending'}>
                        <option value="pending">Needs review</option>
                        <option value="approved">Approve exception / eligibility</option>
                        <option value="declined">Decline exception</option>
                      </select>
                    </label>
                    <label>
                      Reason and supporting rule
                      <textarea
                        required
                        name="reason"
                        maxLength={4000}
                        defaultValue={e?.reason || ''}
                      />
                    </label>
                  </EligibilityForm>
                </details>
              </article>
            );
          })}
        </>
      )}
    </section>
  );
}
