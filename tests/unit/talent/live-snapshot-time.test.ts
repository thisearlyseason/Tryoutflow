import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveSnapshotTime } from '@/modules/talent/application/live-snapshot-time';

const environment = {
  NODE_ENV: 'production',
  TRYOUTFLOW_SERVER_TEST_ENV: 'task30-playwright',
  TRYOUTFLOW_BOT_PROTECTION_MODE: 'deterministic-test',
  NEXT_PUBLIC_APP_URL: 'https://task30.e2e.example.test',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  TRYOUTFLOW_VISUAL_FIXED_NOW: '2026-08-28T18:05:00.000Z',
};
afterEach(() => vi.useRealTimers());

describe('live snapshot display clock', () => {
  it('freezes the exact local production-build visual fixture', () => {
    expect(liveSnapshotTime(environment)).toBe(environment.TRYOUTFLOW_VISUAL_FIXED_NOW);
  });
  it.each(Object.keys(environment))('uses the real clock when %s is absent', (key) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2028-01-01T12:00:00.000Z'));
    const incomplete: Record<string, string | undefined> = { ...environment };
    delete incomplete[key];
    expect(liveSnapshotTime(incomplete)).toBe('2028-01-01T12:00:00.000Z');
  });
  it.each([
    { NEXT_PUBLIC_APP_URL: 'https://www.tryout.agency' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' },
    { TRYOUTFLOW_VISUAL_FIXED_NOW: '2028-01-01T00:00:00.000Z' },
    { NODE_ENV: 'test' },
  ])('does not override production, remote or arbitrary clock values: %j', (change) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2028-01-01T12:00:00.000Z'));
    expect(liveSnapshotTime({ ...environment, ...change })).toBe('2028-01-01T12:00:00.000Z');
  });
});
