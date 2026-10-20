import { createHash, timingSafeEqual } from 'node:crypto';

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization') ?? '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!secret || !timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const [{ createAdminSupabaseClient }, { ResendEmailProvider }, { sendDeletionNotices }] =
      await Promise.all([
        import('@/infrastructure/supabase/admin'),
        import('@/infrastructure/email/resend-provider'),
        import('@/modules/identity/application/deletion-notices'),
      ]);
    await sendDeletionNotices(
      createAdminSupabaseClient(),
      new ResendEmailProvider({
        apiKey: process.env.RESEND_API_KEY,
        from: process.env.RESEND_FROM_EMAIL,
        timeoutMs: 2_000,
      }),
    );
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // Return a failing cron status while keeping credentials and queue contents private.
    return Response.json({ error: 'temporarily_unavailable' }, { status: 503 });
  }
}
