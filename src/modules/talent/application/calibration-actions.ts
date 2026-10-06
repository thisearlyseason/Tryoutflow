'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
export async function createCalibration(slug: string, input: unknown) {
  const p = z
    .strictObject({
      id: z.uuid(),
      title: z.string().trim().min(1).max(160),
      prompt: z.string().trim().min(1).max(8000),
      guidance: z.string().trim().min(1).max(4000),
      anchor: z.coerce.number().int().min(1).max(10),
      explanation: z.string().trim().min(1).max(4000),
    })
    .safeParse(input);
  if (!p.success)
    return { ok: false, message: 'Complete the case, rubric and reference explanation.' };
  const c = await requireCurrentOrganization(slug);
  const { error } = await c.client.rpc('create_calibration_case', {
    p_organization_id: c.organization.id,
    p_id: p.data.id,
    p_title: p.data.title,
    p_prompt: p.data.prompt,
    p_guidance: p.data.guidance,
    p_anchor: p.data.anchor,
    p_explanation: p.data.explanation,
  });
  if (error)
    return {
      ok: false,
      message: 'The calibration case could not be created. Check your permissions or refresh.',
    };
  revalidatePath(`/app/${slug}/evaluate/calibration`);
  return { ok: true, message: 'Calibration case created.' };
}
export async function submitCalibration(slug: string, input: unknown) {
  const p = z
    .strictObject({
      case_id: z.uuid(),
      score: z.coerce.number().int().min(1).max(10),
      rationale: z.string().trim().min(1).max(4000),
    })
    .safeParse(input);
  if (!p.success)
    return { ok: false, message: 'Enter a score from 1–10 and explain the evidence.' };
  const c = await requireCurrentOrganization(slug);
  const { error } = await c.client.rpc('submit_calibration', {
    p_organization_id: c.organization.id,
    p_case_id: p.data.case_id,
    p_score: p.data.score,
    p_rationale: p.data.rationale,
  });
  if (error)
    return {
      ok: false,
      message: 'This case may already be submitted or is unavailable. Refresh to review.',
    };
  revalidatePath(`/app/${slug}/evaluate/calibration`);
  return {
    ok: true,
    message: 'Submitted. Review the reference and discuss differences with your lead.',
  };
}
