'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { normalizeOrganizationLogo } from '@/modules/organizations/application/normalize-organization-logo';
export async function savePortrait(
  slug: string,
  athleteId: string,
  version: number,
  form: FormData,
) {
  const c = await requireCurrentOrganization(slug);
  if (
    !['owner', 'administrator'].includes(c.authorization.organizationRole) ||
    !z.uuid().safeParse(athleteId).success
  )
    return { ok: false, message: 'Organizer access required.' };
  const file = form.get('portrait');
  if (!(file instanceof File)) return { ok: false, message: 'Choose a photo.' };
  try {
    const image = await normalizeOrganizationLogo(file);
    const { error } = await c.client.rpc('save_athlete_portrait', {
      p_organization_id: c.organization.id,
      p_athlete_id: athleteId,
      p_version: version,
      p_base64: image.base64,
      p_sha256: image.sha256,
    });
    if (error)
      return {
        ok: false,
        message: 'The portrait changed or could not be saved. Refresh and retry.',
      };
    revalidatePath(`/app/${slug}/athletes/${athleteId}`);
    return { ok: true, message: 'Photo saved.' };
  } catch {
    return { ok: false, message: 'Use a valid JPEG, PNG or WebP photo smaller than 2 MB.' };
  }
}
export async function saveContact(slug: string, input: unknown) {
  const p = z
    .strictObject({
      athlete_id: z.uuid(),
      name: z.string().trim().min(1).max(160),
      email: z.email().max(254),
      phone: z.string().trim().max(80),
      relationship: z.string().trim().min(1).max(80),
      guardian_id: z.uuid().optional(),
      updated_at: z.string().optional(),
    })
    .safeParse(input);
  if (!p.success)
    return { ok: false, message: 'Provide a contact name, valid email and relationship.' };
  const c = await requireCurrentOrganization(slug);
  const { error } = await c.client.rpc('save_athlete_contact', {
    p_organization_id: c.organization.id,
    p_athlete_id: p.data.athlete_id,
    p_name: p.data.name,
    p_email: p.data.email,
    p_phone: p.data.phone,
    p_relationship: p.data.relationship,
    p_guardian_id: p.data.guardian_id ?? null,
    p_expected_updated_at: p.data.updated_at ?? null,
  });
  if (error)
    return {
      ok: false,
      message:
        'Contact could not be saved. Check for an existing contact or refresh after another edit.',
    };
  revalidatePath(`/app/${slug}/athletes/${p.data.athlete_id}`);
  return {
    ok: true,
    message:
      'Contact saved. Existing contacts with this email are linked using their current details.',
  };
}
