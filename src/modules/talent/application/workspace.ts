import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { getEffectiveEntitlements } from '@/modules/subscriptions/application/billing-service';
import { hasEntitlement } from '@/modules/subscriptions/domain/effective-entitlements';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import type { Database } from '@/infrastructure/supabase/database.types';
export type Row<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export async function talentContext(slug: string) {
  const c = await requireCurrentOrganization(slug);
  if (
    process.env.BILLING_ENVIRONMENT &&
    !hasEntitlement(await getEffectiveEntitlements(c.organization.id), 'advanced_scouting')
  )
    redirect(`/app/${slug}/organization/billing?feature=advanced_scouting`);
  const { data, error } = await c.client.rpc('can_use_talent', {
    p_organization_id: c.organization.id,
  });
  if (error || !data) notFound();
  return c;
}
export type PerformanceFilters = { session?: string; from?: string; to?: string };
/** Paginate across PostgREST's row limit. Never calculate benchmarks from a silently truncated cohort. */
export async function pages<T>(
  query: (offset: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  label: string,
) {
  const data: T[] = [];
  for (let offset = 0; offset <= 10000; offset += 1000) {
    const r = await query(offset);
    if (r.error) return { data: null, error: r.error };
    if (offset === 10000 && r.data?.length)
      throw new Error(
        `${label} exceeds this workspace's 10,000-record limit. Narrow the athlete, session or date range.`,
      );
    data.push(...(r.data ?? []));
    if ((r.data?.length ?? 0) < 1000) return { data, error: null };
  }
  return { data, error: null };
}
export async function loadTalent(
  slug: string,
  athleteId?: string,
  filters: PerformanceFilters = {},
) {
  const current = await talentContext(slug),
    client = current.client,
    id = current.organization.id;
  const queries = await Promise.all([
    pages((offset) => {
      let q = client
        .from('athletes')
        .select('id,given_name,family_name,birth_date')
        .eq('organization_id', id)
        .order('family_name')
        .order('id')
        .range(offset, offset + 999);
      if (athleteId) q = q.eq('id', athleteId);
      return q;
    }, 'Athlete selection'),
    pages((offset) => {
      let q = client
        .from('athlete_sport_profiles')
        .select('*')
        .eq('organization_id', id)
        .order('id')
        .range(offset, offset + 999);
      if (athleteId) q = q.eq('athlete_id', athleteId);
      return q;
    }, 'Sporting profiles'),
    pages(
      (offset) =>
        client
          .from('performance_metrics')
          .select('*')
          .eq('organization_id', id)
          .order('sport')
          .order('name')
          .order('id')
          .range(offset, offset + 999),
      'Metric catalog',
    ),
    pages((offset) => {
      let q = client
        .from('performance_results')
        .select('*')
        .eq('organization_id', id)
        .order('measured_at', { ascending: false })
        .order('id')
        .range(offset, offset + 999);
      if (athleteId) q = q.eq('athlete_id', athleteId);
      if (filters.session && /^[0-9a-f-]{36}$/i.test(filters.session))
        q = q.eq('session_id', filters.session);
      if (filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from))
        q = q.gte('measured_at', `${filters.from}T00:00:00Z`);
      if (filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to))
        q = q.lte('measured_at', `${filters.to}T23:59:59.999Z`);
      return q;
    }, 'Performance dataset'),
    pages((offset) => {
      let q = client
        .from('scouting_records')
        .select('*')
        .eq('organization_id', id)
        .order('created_at', { ascending: false })
        .order('id')
        .range(offset, offset + 999);
      if (athleteId) q = q.eq('athlete_id', athleteId);
      return q;
    }, 'Scouting records'),
    pages(
      (offset) =>
        client
          .from('tryouts')
          .select('id,name')
          .eq('organization_id', id)
          .order('created_at', { ascending: false })
          .order('id')
          .range(offset, offset + 999),
      'Tryouts',
    ),
    pages(
      (offset) =>
        client
          .from('tryout_sessions')
          .select('id,name,tryout_id')
          .eq('organization_id', id)
          .order('id')
          .range(offset, offset + 999),
      'Sessions',
    ),
    pages(
      (offset) =>
        client
          .from('evaluator_sport_profiles')
          .select('*')
          .eq('organization_id', id)
          .order('display_name')
          .order('id')
          .range(offset, offset + 999),
      'Evaluator profiles',
    ),
  ]);
  if (queries.some((q) => q.error))
    throw new Error('Scouting data is temporarily unavailable. Refresh and try again.');
  const [athletes, profiles, metrics, results, records, tryouts, sessions, evaluators] = queries;
  const people = await client.rpc('scouting_people', { p_organization_id: id });
  if (people.error) throw new Error('Staff names could not load.');
  return {
    current,
    people: people.data ?? [],
    athletes: athletes.data ?? [],
    profiles: profiles.data ?? [],
    metrics: metrics.data ?? [],
    results: results.data ?? [],
    records: records.data ?? [],
    tryouts: tryouts.data ?? [],
    sessions: sessions.data ?? [],
    evaluators: evaluators.data ?? [],
  };
}
export type TalentWorkspace = Awaited<ReturnType<typeof loadTalent>>;

/** A single-event report never requires or loads organization-wide scouting/history. */
export async function loadDecisionPacketWorkspace(
  slug: string,
  tryoutId: string,
): Promise<TalentWorkspace & { scoutingIncluded: boolean }> {
  const current = await requireCurrentOrganization(slug);
  if (!['owner', 'administrator'].includes(current.authorization.organizationRole)) notFound();
  const access = process.env.BILLING_ENVIRONMENT
    ? await getEffectiveEntitlements(current.organization.id, tryoutId)
    : null;
  if (access && !hasEntitlement(access, 'export_reports'))
    redirect(`/app/${slug}/organization/billing?feature=export_reports`);
  const orgAccess = process.env.BILLING_ENVIRONMENT
    ? await getEffectiveEntitlements(current.organization.id)
    : null;
  if (!orgAccess || hasEntitlement(orgAccess, 'advanced_scouting'))
    return { ...(await loadTalent(slug)), scoutingIncluded: true };
  const [events, sessions, registrations] = await Promise.all([
    current.client
      .from('tryouts')
      .select('id,name')
      .eq('organization_id', current.organization.id)
      .eq('id', tryoutId),
    current.client
      .from('tryout_sessions')
      .select('id,name,tryout_id')
      .eq('organization_id', current.organization.id)
      .eq('tryout_id', tryoutId),
    pages(
      (offset) =>
        current.client
          .from('tryout_registrations')
          .select('athlete_id')
          .eq('organization_id', current.organization.id)
          .eq('tryout_id', tryoutId)
          .order('id')
          .range(offset, offset + 999),
      'Event athletes',
    ),
  ]);
  if (events.error || sessions.error || registrations.error)
    throw new Error('Event report could not load.');
  const athleteIds = [...new Set(registrations.data?.map((r) => r.athlete_id))];
  const athletes: TalentWorkspace['athletes'] = [];
  for (let offset = 0; offset < athleteIds.length; offset += 100) {
    const result = await current.client
      .from('athletes')
      .select('id,given_name,family_name,birth_date')
      .eq('organization_id', current.organization.id)
      .in('id', athleteIds.slice(offset, offset + 100));
    if (result.error) throw new Error('Event athletes could not load.');
    athletes.push(...result.data);
  }
  return {
    current,
    scoutingIncluded: false,
    athletes,
    tryouts: events.data ?? [],
    sessions: sessions.data ?? [],
    profiles: [],
    metrics: [],
    results: [],
    records: [],
    evaluators: [],
    people: [],
  };
}
