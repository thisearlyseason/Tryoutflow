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
  return (
    <>
      <section className="mx-auto max-w-7xl px-4 pt-10 sm:px-6">
        <h1 className="text-3xl font-black">Try the interactive TryoutFlow demo</h1>
        <p className="mt-3 max-w-3xl leading-7">
          Explore a sample U15 hockey tryout: check in athletes, record scores, review rankings and
          build a roster. No sign-up is required. Demo records are sample data stored in this
          browser and reset every 30 minutes.
        </p>
      </section>
      <DemoWorkspace />
    </>
  );
}
