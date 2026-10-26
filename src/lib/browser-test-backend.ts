/** Only fixed loopback backends belong to the local production browser harness. */
export function isBrowserTestBackend(environment: Record<string, string | undefined>) {
  const backend = environment.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (/^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/u.test(backend)) return true;
  return (
    /^tryoutflow-lint-verify-[0-9a-f]{12}$/u.test(
      environment.TRYOUTFLOW_ISOLATED_RELEASE_PROJECT ?? '',
    ) && /^http:\/\/(?:127\.0\.0\.1|localhost):62321\/?$/u.test(backend)
  );
}
