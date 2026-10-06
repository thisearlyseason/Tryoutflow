// Reports are ephemeral cache files. A killed app cannot execute sharing's finally.
// Reconcile only this app's UUID report filenames, never unrelated cache entries.
type ReportFileSystem = {
  cacheDirectory: string | null;
  readDirectoryAsync: (directory: string) => Promise<string[]>;
  deleteAsync: (uri: string, options: { idempotent: boolean }) => Promise<void>;
};
const reportName =
  /^tryoutflow-report-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(csv|json|pdf)$/i;
export async function cleanupTemporaryReports(files: ReportFileSystem): Promise<void> {
  if (!files.cacheDirectory) throw new Error('report_cache_unavailable');
  const names = await files.readDirectoryAsync(files.cacheDirectory);
  for (const name of names) {
    if (reportName.test(name)) {
      await files.deleteAsync(`${files.cacheDirectory}${name}`, { idempotent: true });
    }
  }
}
