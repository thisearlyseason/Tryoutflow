import Link from 'next/link';

import { loadEvaluatorDestinations } from '@/modules/evaluations/infrastructure/evaluator-session-loader';
import { EvaluationRouteMessage } from '@/modules/evaluations/ui/session-state';

export default async function EvaluatorLandingPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const loaded = await loadEvaluatorDestinations(organizationSlug);
  if (loaded.outcome === 'unexpected') return <EvaluationRouteMessage outcome="unexpected" />;
  const { destinations } = loaded.value;
  return (
    <section aria-labelledby="evaluation-landing-heading" className="grid min-w-0 gap-5">
      <header>
        <p className="eyebrow">Evaluator workspace</p>
        <h2 id="evaluation-landing-heading">Your assigned sessions</h2>
        <p className="mt-2 text-[var(--color-text-muted)]">
          Only active evaluator assignments are listed. Athlete details stay inside each assigned
          session.
        </p>
      </header>
      {destinations.length === 0 ? (
        <EvaluationRouteMessage outcome="empty_assignments" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {destinations.map((destination) => (
            <li
              className="grid min-w-0 gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
              key={destination.sessionId}
            >
              <div className="min-w-0">
                <p className="eyebrow break-words">{destination.tryoutName}</p>
                <h3 className="break-words">{destination.sessionName}</h3>
              </div>
              <Link
                className="min-h-[44px] rounded-lg bg-[var(--color-primary)] px-4 py-3 text-center font-bold text-[var(--color-primary-foreground)]"
                href={`/app/${organizationSlug}/evaluate/session/${destination.sessionId}`}
              >
                Open scoring session
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
