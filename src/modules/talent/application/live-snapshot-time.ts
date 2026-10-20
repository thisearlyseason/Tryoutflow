import { isExactDeterministicBotTestEnvironment } from '@/modules/identity/application/bot-protection';

const visualFixtureTime = '2026-08-28T18:05:00.000Z';

/** Freeze only the visual fixture's display timestamp, never a domain clock. */
export function liveSnapshotTime(environment: Record<string, string | undefined> = process.env) {
  if (
    environment.NODE_ENV === 'production' &&
    isExactDeterministicBotTestEnvironment(environment) &&
    environment.TRYOUTFLOW_VISUAL_FIXED_NOW === visualFixtureTime
  ) {
    return visualFixtureTime;
  }
  return new Date().toISOString();
}
