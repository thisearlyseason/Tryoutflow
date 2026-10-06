import { z } from 'zod';
import { talentContext } from '@/modules/talent/application/workspace';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationSlug: string; exportId: string }> },
) {
  const { organizationSlug, exportId } = await params;
  if (!z.uuid().safeParse(exportId).success) return new Response('Not found', { status: 404 });
  const c = await talentContext(organizationSlug);
  const { data, error } = await c.client.rpc('download_performance_export', {
    p_organization_id: c.organization.id,
    p_id: exportId,
  });
  if (error || !data)
    return new Response('Export unavailable, expired or not ready.', {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  const bytes = new TextEncoder().encode(data);
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + 65536));
      offset += 65536;
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="performance-export.csv"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
