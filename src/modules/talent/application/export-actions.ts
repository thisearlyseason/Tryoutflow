'use server';
import { after } from 'next/server';
import { z } from 'zod';
import { talentContext } from './workspace';
const filtersSchema = z.strictObject({
  from: z.union([z.iso.date(), z.literal('')]),
  to: z.union([z.iso.date(), z.literal('')]),
  session: z.union([z.uuid(), z.literal('')]),
  metric: z.union([z.uuid(), z.literal('')]),
});
export async function startPerformanceExport(slug: string, input: unknown) {
  const parsed = filtersSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Review the export filters.' };
  const c = await talentContext(slug);
  const id = crypto.randomUUID();
  const { error } = await c.client.rpc('start_performance_export', {
    p_organization_id: c.organization.id,
    p_id: id,
    p_filters: parsed.data,
  });
  if (error)
    return {
      ok: false,
      message: 'Export could not start. Up to 20 exports can be requested per hour.',
    };
  after(async () => {
    await c.client.rpc('build_performance_export', {
      p_organization_id: c.organization.id,
      p_id: id,
    });
  });
  return { ok: true, message: 'Export queued. You can continue working while it prepares.', id };
}
export async function getPerformanceExport(slug: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const c = await talentContext(slug);
  const { data, error } = await c.client.rpc('performance_export_status', {
    p_organization_id: c.organization.id,
    p_id: id,
  });
  if (error) return null;
  return data as { state: string; rows: number | null; message: string; expires_at: string } | null;
}
export async function retryPerformanceExport(slug: string, id: string) {
  if (!z.uuid().safeParse(id).success) return;
  const c = await talentContext(slug);
  const status = await c.client.rpc('performance_export_status', {
    p_organization_id: c.organization.id,
    p_id: id,
  });
  if (!status.data || status.error) return;
  after(async () => {
    await c.client.rpc('build_performance_export', {
      p_organization_id: c.organization.id,
      p_id: id,
    });
  });
}
