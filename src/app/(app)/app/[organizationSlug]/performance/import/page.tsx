import Link from 'next/link';
import { loadTalent } from '@/modules/talent/application/workspace';
import { MeasurementImport } from '@/modules/talent/ui/measurement-import';
export default async function Page({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug: slug } = await params;
  const w = await loadTalent(slug);
  return (
    <section className="talent-stack">
      <Link href={`/app/${slug}/performance`}>← Performance lab</Link>
      <h1>Import measurements</h1>
      <MeasurementImport
        slug={slug}
        athletes={w.athletes}
        metrics={w.metrics}
        sessions={w.sessions}
      />
    </section>
  );
}
