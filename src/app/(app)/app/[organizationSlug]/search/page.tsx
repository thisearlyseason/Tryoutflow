import { FeedbackButton } from '@/components/ui/button';
import Link from 'next/link';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { organizationSlug: slug } = await params;
  const q = ((await searchParams).q ?? '').trim().slice(0, 120);
  const c = await requireCurrentOrganization(slug);
  const pattern = `%${q.replaceAll(/[%_(),\\]/g, '')}%`;
  let athleteQuery = c.client
    .from('athletes')
    .select('id,given_name,family_name')
    .eq('organization_id', c.organization.id);
  for (const token of q
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8))
    athleteQuery = athleteQuery.or(`given_name.ilike.%${token}%,family_name.ilike.%${token}%`);
  const [athletes, events, people] =
    q.length >= 2
      ? await Promise.all([
          athleteQuery.limit(30),
          c.client
            .from('tryouts')
            .select('id,name')
            .eq('organization_id', c.organization.id)
            .ilike('name', pattern)
            .limit(30),
          c.client
            .from('evaluator_sport_profiles')
            .select('id,display_name,sport,specialties')
            .eq('organization_id', c.organization.id)
            .ilike('display_name', pattern)
            .limit(30),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];
  return (
    <section className="talent-stack">
      <h1>Search your organization</h1>
      <form className="talent-search">
        <label>
          Athlete, tryout or evaluator
          <input name="q" defaultValue={q} minLength={2} maxLength={120} />
        </label>
        <FeedbackButton className="button-primary">Search</FeedbackButton>
      </form>
      <p>
        Results respect your access. Enter at least two characters. Up to 30 matches appear in each
        section.
      </p>
      {[athletes, events, people].some((r) => r.error) && (
        <p role="alert">Some results could not load. Refresh to retry.</p>
      )}
      <div className="talent-grid">
        <section className="talent-card">
          <h2>Athletes</h2>
          {athletes.data?.map((a) => (
            <p key={a.id}>
              <Link href={`/app/${slug}/athletes/${a.id}`}>
                {a.given_name} {a.family_name}
              </Link>
            </p>
          ))}
          {!athletes.data?.length && <p>No matches.</p>}
        </section>
        <section className="talent-card">
          <h2>Tryouts</h2>
          {events.data?.map((t) => (
            <p key={t.id}>
              <Link href={`/app/${slug}/tryouts/${t.id}/overview`}>{t.name}</Link>
            </p>
          ))}
          {!events.data?.length && <p>No matches.</p>}
        </section>
        <section className="talent-card">
          <h2>Evaluators</h2>
          {people.data?.map((p) => (
            <p key={p.id}>
              {p.display_name} · {p.sport}
              <br />
              {p.specialties}
            </p>
          ))}
          {!people.data?.length && <p>No matches.</p>}
        </section>
      </div>
    </section>
  );
}
