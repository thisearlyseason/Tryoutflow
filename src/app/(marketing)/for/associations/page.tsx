import type { Metadata } from 'next';

import { marketingMetadata } from '../../../../modules/marketing/content/metadata';
import { AudiencePage } from '../../../../modules/marketing/ui/audience-page';

export const metadata: Metadata = marketingMetadata({
  path: '/for/associations',
  title: 'For Associations | TryoutFlow',
  description:
    'Coordinate association tryout programs with consistent workflow and explicit oversight.',
});

export default function AssociationsPage() {
  return (
    <AudiencePage
      eyebrow="For associations"
      title="Association-wide structure, local responsibility."
      summary="Coordinate a broad tryout program without turning every evaluator or check-in station into an association-wide admin surface."
      operatingModel="Association leaders can establish a consistent operating model across divisions while local staff work only within their role and assigned scope."
      outcomes={[
        {
          title: 'Program consistency',
          detail:
            'A common workflow helps each division reach the same readiness and review gates.',
        },
        {
          title: 'Operational boundaries',
          detail: 'Tenant, role, and resource checks protect association data at each request.',
        },
        {
          title: 'Auditable actions',
          detail: 'High-value publishing, roster, communication, and export steps are explicit.',
        },
      ]}
    />
  );
}
