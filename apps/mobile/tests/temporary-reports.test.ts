import { expect, it, vi } from 'vitest';
import { cleanupTemporaryReports } from '../src/temporary-reports';
it('reconciles only UUID-named temporary reports left by interrupted sharing', async () => {
  const deleteAsync = vi.fn(async () => {});
  await cleanupTemporaryReports({
    cacheDirectory: 'file:///cache/',
    readDirectoryAsync: async () => [
      'tryoutflow-report-11111111-1111-4111-8111-111111111111.csv',
      'tryoutflow-report-22222222-2222-4222-8222-222222222222.json',
      'tryoutflow-report-33333333-3333-4333-8333-333333333333.pdf',
      'owner-photo.png',
      'tryoutflow-report-invalid.csv',
      '../tryoutflow-report-11111111-1111-4111-8111-111111111111.csv',
      'saved-report.pdf',
    ],
    deleteAsync,
  });
  expect(deleteAsync.mock.calls).toEqual([
    [
      'file:///cache/tryoutflow-report-11111111-1111-4111-8111-111111111111.csv',
      { idempotent: true },
    ],
    [
      'file:///cache/tryoutflow-report-22222222-2222-4222-8222-222222222222.json',
      { idempotent: true },
    ],
    [
      'file:///cache/tryoutflow-report-33333333-3333-4333-8333-333333333333.pdf',
      { idempotent: true },
    ],
  ]);
});
it('unavailable cache rejects without filesystem mutation', async () => {
  const readDirectoryAsync = vi.fn(),
    deleteAsync = vi.fn();
  await expect(
    cleanupTemporaryReports({ cacheDirectory: null, readDirectoryAsync, deleteAsync }),
  ).rejects.toThrow('report_cache_unavailable');
  expect(readDirectoryAsync).not.toHaveBeenCalled();
  expect(deleteAsync).not.toHaveBeenCalled();
});
it('cleanup failure remains rejected so new sharing cannot race it', async () => {
  const deleteAsync = vi.fn(async () => {
    throw Error('denied');
  });
  await expect(
    cleanupTemporaryReports({
      cacheDirectory: 'file:///cache/',
      readDirectoryAsync: async () => [
        'tryoutflow-report-11111111-1111-4111-8111-111111111111.csv',
      ],
      deleteAsync,
    }),
  ).rejects.toThrow('denied');
});
