import type { Metadata } from 'next';
import { marketingMetadata } from '../../../modules/marketing/content/metadata';
import { DemoWorkspace } from '../../../modules/demo/demo-workspace';

export const metadata: Metadata = marketingMetadata({
  path: '/demo',
  title: 'Try the Interactive Demo | TryoutFlow',
  description:
    'Try a pre-created TryoutFlow workspace. Check in sample athletes, enter scores, review rankings and build a roster. Your demo resets every 30 minutes.',
});

export default function DemoPage() {
  return <DemoWorkspace />;
}
