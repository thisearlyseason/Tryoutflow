import type { Metadata } from 'next';
import { Suspense } from 'react';
import { GuideAudienceReader, GuideReader } from '@/modules/how-to/guide-reader';
import { marketingMetadata } from '@/modules/marketing/content/metadata';
import './how-to.css';

export const metadata: Metadata = marketingMetadata({
  path: '/how-to',
  title: 'How to use TryoutFlow | Guides for every role',
  description:
    'Detailed TryoutFlow guides with screenshots for coaches, evaluators, check-in staff, reviewers, parents, athletes and scouting teams. Follow team workspaces, Single Tryout completion, registration, scoring and reporting from start to finish.',
});

export default function HowToPage() {
  return (
    <Suspense fallback={<GuideReader audience="coaches" />}>
      <GuideAudienceReader />
    </Suspense>
  );
}
