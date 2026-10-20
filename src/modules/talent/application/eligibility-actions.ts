'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { talentContext } from './workspace';
const version = z.coerce.number().int().min(0);
export async function saveEligibility(slug: string, input: unknown) {
  const parsed = z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('policy'),
        tryout_id: z.uuid(),
        cutoff_date: z.iso.date(),
        rules: z.string().trim().max(8000),
        version,
      }),
      z.object({
        kind: z.literal('exception'),
        tryout_id: z.uuid(),
        athlete_id: z.uuid(),
        policy_version: z.coerce.number().int().positive(),
        status: z.enum(['pending', 'approved', 'declined']),
        reason: z.string().trim().min(1).max(4000),
        version,
      }),
    ])
    .safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      message: 'Complete the required fields with a valid cutoff date and review reason.',
    };
  const c = await talentContext(slug);
  if (!['owner', 'administrator'].includes(c.authorization.organizationRole))
    return { ok: false, message: 'An organizer must record eligibility rules and reviews.' };
  const v = parsed.data;
  const r =
    v.kind === 'policy'
      ? await c.client.rpc('save_eligibility_policy', {
          p_organization_id: c.organization.id,
          p_tryout_id: v.tryout_id,
          p_cutoff_date: v.cutoff_date,
          p_rules: v.rules,
          p_version: v.version,
        })
      : await c.client.rpc('save_eligibility_exception', {
          p_organization_id: c.organization.id,
          p_tryout_id: v.tryout_id,
          p_athlete_id: v.athlete_id,
          p_policy_version: v.policy_version,
          p_status: v.status,
          p_reason: v.reason,
          p_version: v.version,
        });
  if (r.error)
    return {
      ok: false,
      message:
        r.error.code === '40001' || r.error.code === '23505'
          ? 'This record changed. Refresh and review before saving.'
          : 'Could not save the eligibility review. Check the fields and retry.',
    };
  revalidatePath(`/app/${slug}/tryouts/${v.tryout_id}/eligibility`);
  return { ok: true, message: 'Eligibility review saved.' };
}
