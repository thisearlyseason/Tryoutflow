export type DetailedHealth = Readonly<{
  database: 'ok';
  failedJobs: number;
  webhookFailures: number;
  communicationFailures: number;
  integrationFailures: number;
  synchronizationProblems: number;
}>;

export interface HealthGateway {
  readCoarse(): Promise<'ok'>;
  /** Returns null when this caller has no current platform authority. */
  readDetailed(): Promise<DetailedHealth | null>;
}

const headers = {
  'cache-control': 'no-store',
  vary: 'Cookie',
} as const;

export async function handleHealthRequest(gateway: HealthGateway): Promise<Response> {
  try {
    await gateway.readCoarse();
  } catch {
    return Response.json({ status: 'degraded' }, { status: 503, headers });
  }

  try {
    const details = await gateway.readDetailed();
    if (details) return Response.json({ status: 'ok', details }, { headers });
  } catch {
    // Detailed denial and provider failure collapse to the same coarse response.
  }
  return Response.json({ status: 'ok' }, { headers });
}
