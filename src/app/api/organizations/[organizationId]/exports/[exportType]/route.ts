import {
  createReportExport,
  type ReportExportType,
} from '../../../../../../modules/reports/application/create-report-export';
import type { AuthorizationContext } from '../../../../../../modules/organizations/application/capabilities';

type ExportResult = Awaited<ReturnType<typeof createReportExport>>;
type Dependencies = Readonly<{
  authorize(organizationId: string): Promise<AuthorizationContext | null>;
  execute(
    input: {
      organizationId: string;
      tryoutId?: string;
      rosterVersionId?: string;
      exportType: ReportExportType;
    },
    actor: AuthorizationContext,
  ): Promise<ExportResult>;
}>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const types = new Set<ReportExportType>(['athletes', 'evaluations', 'roster']);
const privateHeaders = {
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
};

function text(message: string, status: number): Response {
  return new Response(message, { status, headers: privateHeaders });
}

function streamedCsv(
  chunks: readonly Uint8Array[],
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  let index = 0;
  let stopped = false;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (stopped) return;
        if (signal.aborted) {
          stopped = true;
          controller.error(signal.reason ?? new DOMException('Request aborted', 'AbortError'));
          return;
        }
        const chunk = chunks[index++];
        if (chunk) controller.enqueue(chunk);
        if (index >= chunks.length) {
          stopped = true;
          controller.close();
        }
      },
      cancel() {
        stopped = true;
        index = chunks.length;
      },
    },
    { highWaterMark: 0 },
  );
}

export async function handleExportRequest(
  request: Request,
  params: { organizationId: string; exportType: string },
  dependencies: Dependencies,
): Promise<Response> {
  if (!uuid.test(params.organizationId) || !types.has(params.exportType as ReportExportType)) {
    return text('Export not found.', 404);
  }
  const url = new URL(request.url);
  const tryoutId = url.searchParams.get('tryoutId') ?? undefined;
  const rosterVersionId = url.searchParams.get('rosterVersionId') ?? undefined;
  if ((tryoutId && !uuid.test(tryoutId)) || (rosterVersionId && !uuid.test(rosterVersionId))) {
    return text('Export not found.', 404);
  }
  if (request.signal.aborted) return text('The export request was cancelled.', 499);
  let result: ExportResult;
  try {
    const actor = await dependencies.authorize(params.organizationId);
    if (!actor) return text('Export not found.', 404);
    result = await dependencies.execute(
      {
        organizationId: params.organizationId,
        tryoutId,
        rosterVersionId,
        exportType: params.exportType as ReportExportType,
      },
      actor,
    );
  } catch {
    return text('The export is temporarily unavailable.', 503);
  }
  if (request.signal.aborted) return text('The export request was cancelled.', 499);
  if (!result.ok) {
    switch (result.error.code) {
      case 'not_found':
      case 'forbidden':
        return text('Export not found.', 404);
      case 'not_finalized':
        return text('Only a finalized roster can be exported.', 409);
      case 'snapshot_unavailable':
        return text('This finalized roster does not have a verified export snapshot.', 409);
      case 'too_large':
        return text(
          'This export exceeds the download limit. Narrow the report and try again.',
          413,
        );
      case 'unexpected':
        return text('The export is temporarily unavailable.', 503);
    }
  }
  const filename = /^[A-Za-z0-9._-]{1,120}$/u.test(result.value.filename)
    ? result.value.filename
    : 'report.csv';
  return new Response(streamedCsv(result.value.chunks, request.signal), {
    headers: {
      ...privateHeaders,
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'x-export-row-count': String(result.value.rowCount),
      'x-export-truncated': String(result.value.truncated),
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; exportType: string }> },
) {
  const resolved = await params;
  try {
    const { createExportRouteDependencies } = await import('../export-route-dependencies');
    return await handleExportRequest(request, resolved, await createExportRouteDependencies());
  } catch {
    return text('The export is temporarily unavailable.', 503);
  }
}
