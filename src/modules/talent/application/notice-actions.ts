'use server';
import { z } from 'zod';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
export type NoticePreview = {
  notice_id: string;
  version: number;
  title: string;
  body: string;
  status: string;
  digest: string;
  recipients: {
    registration_id: string;
    guardian_id: string;
    name: string | null;
    email: string;
    eligible: boolean;
  }[];
};
export async function previewNotice(
  slug: string,
  noticeId: string,
): Promise<{ ok: boolean; message: string; preview?: NoticePreview }> {
  if (!z.uuid().safeParse(noticeId).success) return { ok: false, message: 'Invalid notice.' };
  const c = await requireCurrentOrganization(slug);
  const { data, error } = await c.client.rpc('preview_event_notice', {
    p_organization_id: c.organization.id,
    p_notice_id: noticeId,
  });
  return error || !data
    ? { ok: false, message: 'Preview unavailable. Refresh and retry.' }
    : {
        ok: true,
        message: 'Review the message and recipients before queueing.',
        preview: data as unknown as NoticePreview,
      };
}
export async function queueNotice(slug: string, noticeId: string, digest: string) {
  if (!z.uuid().safeParse(noticeId).success || !/^[a-f0-9]{64}$/.test(digest))
    return { ok: false, message: 'Refresh the recipient preview.' };
  const c = await requireCurrentOrganization(slug);
  const { data, error } = await c.client.rpc('queue_event_notice', {
    p_organization_id: c.organization.id,
    p_notice_id: noticeId,
    p_expected_digest: digest,
  });
  if (error || !data)
    return {
      ok: false,
      message:
        'The message or recipients changed, or queueing failed. Refresh the preview before retrying.',
    };
  const r = data as { queued: number; replayed: number; suppressed: number };
  return {
    ok: true,
    message: `${r.queued} queued, ${r.replayed} already queued, ${r.suppressed} suppressed by contact preferences. Queueing is not proof of delivery; review delivery status.`,
  };
}
