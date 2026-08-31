import { handleExportRequest } from './export-request';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; exportType: string }> },
) {
  const resolved = await params;
  try {
    const { createExportRouteDependencies } = await import('../export-route-dependencies');
    return await handleExportRequest(request, resolved, await createExportRouteDependencies());
  } catch {
    return new Response('The export is temporarily unavailable.', {
      status: 503,
      headers: {
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }
}
