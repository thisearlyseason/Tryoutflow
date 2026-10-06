'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/infrastructure/supabase/server';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
export async function requestCorrection(input: unknown) {
  const p = z
    .strictObject({
      id: z.uuid(),
      organization_id: z.uuid(),
      athlete_id: z.uuid(),
      request_text: z.string().trim().min(1).max(4000),
    })
    .safeParse(input);
  if (!p.success)
    return { ok: false, message: 'Describe the correction (up to 4,000 characters).' };
  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return { ok: false, message: 'Sign in to request a correction.' };
  const { error } = await client
    .from('athlete_corrections')
    .insert({ ...p.data, created_by: user.id });
  if (error)
    return {
      ok: false,
      message: 'The request could not be saved. Check your athlete access and retry.',
    };
  revalidatePath('/participant');
  return { ok: true, message: 'Correction request saved. Your organizer will review it.' };
}
export async function linkParticipant(slug: string, input: unknown) {
  const p = z
    .strictObject({
      athlete_id: z.uuid(),
      email: z.email(),
      relationship: z.enum(['athlete', 'guardian']),
    })
    .safeParse(input);
  if (!p.success)
    return { ok: false, message: 'Choose an athlete and enter a verified account email.' };
  const c = await requireCurrentOrganization(slug);
  const { error } = await c.client.rpc('link_participant', {
    p_organization_id: c.organization.id,
    p_athlete_id: p.data.athlete_id,
    p_email: p.data.email,
    p_relationship: p.data.relationship,
  });
  if (error)
    return {
      ok: false,
      message:
        'Could not link the account. Confirm the account has a verified email and is not already linked.',
    };
  revalidatePath(`/app/${slug}/participants`);
  return { ok: true, message: 'Participant access linked.' };
}
export async function setScoutingGrant(slug: string, userId: string, enabled: boolean) {
  if (!z.uuid().safeParse(userId).success || typeof enabled !== 'boolean')
    return { ok: false, message: 'Invalid member.' };
  const c = await requireCurrentOrganization(slug);
  if (!['owner', 'administrator'].includes(c.authorization.organizationRole))
    return { ok: false, message: 'Organizer access required.' };
  const result = enabled
    ? await c.client
        .from('scouting_grants')
        .insert({ organization_id: c.organization.id, user_id: userId })
    : await c.client
        .from('scouting_grants')
        .delete()
        .eq('organization_id', c.organization.id)
        .eq('user_id', userId);
  if (result.error) return { ok: false, message: 'Access could not be updated.' };
  revalidatePath(`/app/${slug}`, 'layout');
  return { ok: true, message: 'Scouting access updated.' };
}
export async function respondOffer(input: unknown) {
  const p = z
    .strictObject({
      organization_id: z.uuid(),
      scenario_id: z.uuid(),
      athlete_id: z.uuid(),
      response: z.enum(['accepted', 'declined']),
    })
    .safeParse(input);
  if (!p.success) return { ok: false, message: 'Invalid offer response.' };
  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return { ok: false, message: 'Sign in to respond.' };
  const { error } = await client.rpc('respond_to_offer', {
    p_organization_id: p.data.organization_id,
    p_scenario_id: p.data.scenario_id,
    p_athlete_id: p.data.athlete_id,
    p_response: p.data.response,
  });
  if (error)
    return {
      ok: false,
      message: 'The offer is no longer open or your access changed. Contact the organizer.',
    };
  revalidatePath('/participant');
  return { ok: true, message: 'Your response has been recorded.' };
}
