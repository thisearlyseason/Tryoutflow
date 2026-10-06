'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { talentSchemas, writeSchema } from '../domain/schemas';
import type { Database } from '@/infrastructure/supabase/database.types';

export type SaveResult = { ok: boolean; message: string; errors?: Record<string, string> };
export async function saveTalent(slug: string, input: unknown): Promise<SaveResult> {
  const parsed = writeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Invalid record. Refresh and try again.' };
  const { table, id, version, values } = parsed.data;
  const record = talentSchemas[table].safeParse(values);
  if (!record.success)
    return {
      ok: false,
      message: 'Review the highlighted fields.',
      errors: Object.fromEntries(record.error.issues.map((e) => [String(e.path[0]), e.message])),
    };
  const c = await requireCurrentOrganization(slug);
  const manager = ['owner', 'administrator'].includes(c.authorization.organizationRole);
  if (table === 'evaluator_sport_profiles') {
    if (!manager && values.user_id !== c.userId)
      return { ok: false, message: 'You can only change your own evaluator profile.' };
  } else {
    const allowed = await c.client.rpc('can_use_talent', { p_organization_id: c.organization.id });
    if (!allowed.data || allowed.error)
      return { ok: false, message: 'Scouting access is required.' };
  }
  if (
    [
      'roster_scenarios',
      'roster_scenario_members',
      'tryout_stations',
      'event_notices',
      'event_fees',
      'athlete_corrections',
      'participant_links',
    ].includes(table) &&
    !manager
  )
    return { ok: false, message: 'An organizer must manage event plans and roster scenarios.' };
  if (
    table === 'scouting_records' &&
    !manager &&
    (values.status === 'approved' || values.visibility === 'athlete')
  )
    return { ok: false, message: 'An organizer must approve athlete-facing feedback.' };
  const payload = { ...record.data, organization_id: c.organization.id, id, version: version + 1 };
  // The discriminated table/schema pair is validated above; Postgres enforces the relational contract and RLS.
  const result = await (async () => {
    switch (table) {
      case 'event_notices':
        return version === 0
          ? await c.client
              .from('event_notices')
              .insert({
                ...payload,
                created_by: c.userId,
              } as Database['public']['Tables']['event_notices']['Insert'])
              .select('id')
              .single()
          : await c.client
              .from('event_notices')
              .update(payload as Database['public']['Tables']['event_notices']['Update'])
              .eq('organization_id', c.organization.id)
              .eq('id', id)
              .eq('version', version)
              .select('id')
              .maybeSingle();
      case 'event_fees':
        return version === 0
          ? await c.client
              .from('event_fees')
              .insert({
                ...payload,
                created_by: c.userId,
              } as Database['public']['Tables']['event_fees']['Insert'])
              .select('id')
              .single()
          : await c.client
              .from('event_fees')
              .update(payload as Database['public']['Tables']['event_fees']['Update'])
              .eq('organization_id', c.organization.id)
              .eq('id', id)
              .eq('version', version)
              .select('id')
              .maybeSingle();
      case 'athlete_corrections':
        return version === 0
          ? await c.client
              .from('athlete_corrections')
              .insert({
                ...payload,
                created_by: c.userId,
              } as Database['public']['Tables']['athlete_corrections']['Insert'])
              .select('id')
              .single()
          : await c.client
              .from('athlete_corrections')
              .update(payload as Database['public']['Tables']['athlete_corrections']['Update'])
              .eq('organization_id', c.organization.id)
              .eq('id', id)
              .eq('version', version)
              .select('id')
              .maybeSingle();
      case 'participant_links':
        return version === 0
          ? await c.client
              .from('participant_links')
              .insert({
                ...payload,
                created_by: c.userId,
              } as Database['public']['Tables']['participant_links']['Insert'])
              .select('id')
              .single()
          : await c.client
              .from('participant_links')
              .update(payload as Database['public']['Tables']['participant_links']['Update'])
              .eq('organization_id', c.organization.id)
              .eq('id', id)
              .eq('version', version)
              .select('id')
              .maybeSingle();
      case 'athlete_sport_profiles':
        return version === 0
          ? await c.client
              .from('athlete_sport_profiles')
              .insert({
                ...payload,
                created_by: c.userId,
              } as Database['public']['Tables']['athlete_sport_profiles']['Insert'])
              .select('id')
              .single()
          : await c.client
              .from('athlete_sport_profiles')
              .update(payload as Database['public']['Tables']['athlete_sport_profiles']['Update'])
              .eq('organization_id', c.organization.id)
              .eq('id', id)
              .eq('version', version)
              .select('id')
              .maybeSingle();
      case 'evaluator_sport_profiles':
        return version === 0
          ? await c.client
              .from('evaluator_sport_profiles')
              .insert({
                ...payload,
                created_by: c.userId,
              } as Database['public']['Tables']['evaluator_sport_profiles']['Insert'])
              .select('id')
              .single()
          : await c.client
              .from('evaluator_sport_profiles')
              .update(payload as Database['public']['Tables']['evaluator_sport_profiles']['Update'])
              .eq('organization_id', c.organization.id)
              .eq('id', id)
              .eq('version', version)
              .select('id')
              .maybeSingle();
      case 'performance_metrics':
        return version === 0
          ? await c.client
              .from('performance_metrics')
              .insert({
                ...payload,
                created_by: c.userId,
              } as Database['public']['Tables']['performance_metrics']['Insert'])
              .select('id')
              .single()
          : await c.client
              .from('performance_metrics')
              .update(payload as Database['public']['Tables']['performance_metrics']['Update'])
              .eq('organization_id', c.organization.id)
              .eq('id', id)
              .eq('version', version)
              .select('id')
              .maybeSingle();
      case 'performance_results':
        return version === 0
          ? await c.client
              .from('performance_results')
              .insert({
                ...payload,
                created_by: c.userId,
              } as Database['public']['Tables']['performance_results']['Insert'])
              .select('id')
              .single()
          : await c.client
              .from('performance_results')
              .update(payload as Database['public']['Tables']['performance_results']['Update'])
              .eq('organization_id', c.organization.id)
              .eq('id', id)
              .eq('version', version)
              .select('id')
              .maybeSingle();
      case 'scouting_records':
        return version === 0
          ? await c.client
              .from('scouting_records')
              .insert({
                ...payload,
                created_by: c.userId,
              } as Database['public']['Tables']['scouting_records']['Insert'])
              .select('id')
              .single()
          : await c.client
              .from('scouting_records')
              .update(payload as Database['public']['Tables']['scouting_records']['Update'])
              .eq('organization_id', c.organization.id)
              .eq('id', id)
              .eq('version', version)
              .select('id')
              .maybeSingle();
      case 'tryout_stations':
        return version === 0
          ? await c.client
              .from('tryout_stations')
              .insert({
                ...payload,
                created_by: c.userId,
              } as Database['public']['Tables']['tryout_stations']['Insert'])
              .select('id')
              .single()
          : await c.client
              .from('tryout_stations')
              .update(payload as Database['public']['Tables']['tryout_stations']['Update'])
              .eq('organization_id', c.organization.id)
              .eq('id', id)
              .eq('version', version)
              .select('id')
              .maybeSingle();
      case 'roster_scenarios':
        return version === 0
          ? await c.client
              .from('roster_scenarios')
              .insert({
                ...payload,
                created_by: c.userId,
              } as Database['public']['Tables']['roster_scenarios']['Insert'])
              .select('id')
              .single()
          : await c.client
              .from('roster_scenarios')
              .update(payload as Database['public']['Tables']['roster_scenarios']['Update'])
              .eq('organization_id', c.organization.id)
              .eq('id', id)
              .eq('version', version)
              .select('id')
              .maybeSingle();
      case 'roster_scenario_members':
        return version === 0
          ? await c.client
              .from('roster_scenario_members')
              .insert({
                ...payload,
                created_by: c.userId,
              } as Database['public']['Tables']['roster_scenario_members']['Insert'])
              .select('id')
              .single()
          : await c.client
              .from('roster_scenario_members')
              .update(payload as Database['public']['Tables']['roster_scenario_members']['Update'])
              .eq('organization_id', c.organization.id)
              .eq('id', id)
              .eq('version', version)
              .select('id')
              .maybeSingle();
    }
  })();
  if (result.error || !result.data) {
    const code = result.error?.code;
    return {
      ok: false,
      message:
        code === '23P01'
          ? 'This staff member or group already has a station at that time.'
          : code === '23505'
            ? 'This record already exists. Refresh to review it.'
            : code === '23514'
              ? 'This change does not meet the record rules. Metrics with results need a new protocol; verify values, dates and references.'
              : code === '42501'
                ? 'Your access no longer permits this change.'
                : code === '23503'
                  ? 'The selected athlete, session or staff member is unavailable.'
                  : 'This record changed or could not be saved. Your entries are still here; refresh in another tab before retrying.',
    };
  }
  revalidatePath(`/app/${slug}`, 'layout');
  return { ok: true, message: 'Saved. Your workspace is up to date.' };
}
export async function createProspect(
  slug: string,
  input: unknown,
): Promise<SaveResult & { athleteId?: string }> {
  const parsed = z
    .strictObject({
      id: z.uuid(),
      given_name: z.string().trim().min(1).max(120),
      family_name: z.string().trim().min(1).max(120),
      birth_date: z.union([z.iso.date(), z.literal('')]),
      updated_at: z.string().optional(),
    })
    .safeParse(input);
  if (!parsed.success)
    return { ok: false, message: 'Provide a first and last name and a valid birth date if known.' };
  const c = await requireCurrentOrganization(slug);
  if (!['owner', 'administrator'].includes(c.authorization.organizationRole))
    return { ok: false, message: 'An organizer must add a prospect.' };
  const p = parsed.data;
  if (p.birth_date && p.birth_date > new Date().toISOString().slice(0, 10))
    return { ok: false, message: 'Birth date cannot be in the future.' };
  const result = await c.client.rpc('save_prospect_identity', {
    p_id: p.id,
    p_organization_id: c.organization.id,
    p_given_name: p.given_name,
    p_family_name: p.family_name,
    p_birth_date: p.birth_date || null,
    p_expected_updated_at: p.updated_at ?? null,
  });
  if (result.error)
    return {
      ok: false,
      message: 'The prospect could not be added. Check for an existing record and retry.',
    };
  revalidatePath(`/app/${slug}`, 'layout');
  return {
    ok: true,
    message: p.updated_at ? 'Identity updated.' : 'Prospect added.',
    athleteId: result.data ?? p.id,
  };
}
export async function importMeasurements(slug: string, input: unknown): Promise<SaveResult> {
  const rows = z
    .array(z.strictObject({ id: z.uuid(), values: talentSchemas.performance_results }))
    .min(1)
    .max(500)
    .safeParse(input);
  if (!rows.success)
    return { ok: false, message: 'The import has invalid rows. Review the preview and try again.' };
  const c = await requireCurrentOrganization(slug);
  const { data, error } = await c.client.rpc('import_performance_results', {
    p_organization_id: c.organization.id,
    p_rows: rows.data.map((r) => ({ id: r.id, ...r.values })),
  });
  if (error)
    return {
      ok: false,
      message:
        error.code === '23505'
          ? 'A trial already exists or a retry differs from the saved data. No new rows were imported.'
          : 'The batch could not be imported. Check athlete IDs, metric limits, ratio attempts and dates. No new rows were imported.',
    };
  revalidatePath(`/app/${slug}`, 'layout');
  return {
    ok: true,
    message: `${data} measurements saved. You can review them in the performance lab.`,
  };
}
