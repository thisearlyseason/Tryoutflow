import type { Metadata } from 'next';

import { marketingMetadata } from '../../../../modules/marketing/content/metadata';
import { AudiencePage } from '../../../../modules/marketing/ui/audience-page';

export const metadata: Metadata = marketingMetadata({
  path: '/for/teams',
  title: 'For Teams | TryoutFlow',
  description:
    'Run one team tryout through registration, evaluation, roster review, and participant communication.',
});

export default function TeamsPage() {
  return (
    <AudiencePage
      eyebrow="For teams"
      title="One team. One clear tryout path."
      summary="Replace separate forms, clipboards, score sheets, and roster tabs with a focused operating flow for one team."
      operatingModel="Team staff can publish a tryout, check athletes in, scope evaluators, review complete and incomplete results, and confirm a roster without blurring those responsibilities."
      outcomes={[
        {
          title: 'Less re-entry',
          detail: 'Registration details move into check-in and assigned evaluation scopes.',
        },
        {
          title: 'Independent scoring',
          detail: 'Evaluators record their own work with explicit save and completion state.',
        },
        {
          title: 'Confirmed decisions',
          detail: 'Roster placement, athlete decision, and participant message stay separate.',
        },
      ]}
    />
  );
}
