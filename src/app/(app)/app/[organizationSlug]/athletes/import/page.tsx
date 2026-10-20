import { notFound } from 'next/navigation';

import { requireCapability } from '@/modules/organizations/application/require-capability';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { CsvImportWizard } from '@/modules/registration/ui/csv-import-wizard';

export default async function AthleteImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ previewId?: string }>;
}) {
  const { organizationSlug } = await params;
  const { previewId } = await searchParams;
  const current = await requireCurrentOrganization(organizationSlug);
  if (
    !requireCapability(current.authorization, 'athlete:write', {
      organizationId: current.organization.id,
    }).ok ||
    !['owner', 'administrator'].includes(current.authorization.organizationRole)
  )
    notFound();
  return (
    <section aria-labelledby="athlete-import-heading" className="space-y-4">
      <div>
        <p className="eyebrow">Athlete directory</p>
        <h2 id="athlete-import-heading">Import athletes</h2>
        <p className="text-[var(--color-text-muted)]">
          Map columns, review every validation result, then explicitly confirm valid rows.
        </p>
      </div>
      <CsvImportWizard organizationId={current.organization.id} resumePreviewId={previewId} />
    </section>
  );
}
