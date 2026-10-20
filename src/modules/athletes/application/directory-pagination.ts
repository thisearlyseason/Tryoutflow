export function normalizeAthleteDirectoryPage(
  requestedPage: number,
  totalRows: number,
  pageSize: number,
) {
  const requested = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const lastPage = Math.max(1, Math.ceil(totalRows / pageSize));
  return Math.min(requested, lastPage);
}
