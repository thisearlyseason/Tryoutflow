import type { Metadata } from 'next';

import { marketingMetadata } from '../../../../modules/marketing/content/metadata';
import { AudiencePage } from '../../../../modules/marketing/ui/audience-page';

export const metadata: Metadata = marketingMetadata({
  path: '/for/clubs',
  title: 'For Clubs | TryoutFlow',
  description: 'Coordinate consistent tryout operations for every team in a club.',
});

export default function ClubsPage() {
  return (
    <AudiencePage
      eyebrow="For clubs"
      title="Every team follows the same playbook."
      summary="Create a consistent club-wide process while keeping divisions, sessions, evaluator assignments, and roster work appropriately scoped."
      operatingModel="Club directors can see operational progress across team tryouts while evaluators remain focused on their assigned athletes and check-in staff stay out of rankings."
      outcomes={[
        {
          title: 'Repeatable setup',
          detail:
            'Use a structured path for sessions, forms, rubrics, assignments, and publishing.',
        },
        {
          title: 'Scoped access',
          detail:
            'Owners, directors, evaluators, and check-in staff receive different capabilities.',
        },
        {
          title: 'Visible progress',
          detail: 'Completion context makes unfinished evaluations visible before roster review.',
        },
      ]}
    />
  );
}
