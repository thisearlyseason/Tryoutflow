import { LoadingState } from '@/components/feedback/loading-state';
export default function Loading() {
  return (
    <section className="workspace-card space-y-3 p-6">
      <h1 className="text-2xl">Loading tryouts…</h1>
      <LoadingState label="Preparing the tryout view." />
    </section>
  );
}
