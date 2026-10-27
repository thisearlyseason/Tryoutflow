import Link from 'next/link';

export function DecisionWorkflow({
  base,
  current,
  managesEvent,
  canCompare,
}: {
  base: string;
  current: 'compare' | 'scenarios' | 'rosters';
  managesEvent: boolean;
  canCompare: boolean;
}) {
  const steps = [
    ...(canCompare ? [['compare', 'Compare evidence']] : []),
    ...(managesEvent ? [['scenarios', 'Review alternatives']] : []),
    ['rosters', canCompare || managesEvent ? 'Confirm final roster' : 'Review final roster'],
    ...(managesEvent ? [['messages', 'Preview decision messages']] : []),
  ];
  return (
    <aside className="decision-workflow talent-no-print" aria-label="Selection and sharing">
      <nav aria-label="Selection steps">
        {steps.map(([path, label]) => (
          <Link
            key={path}
            href={`${base}/${path}`}
            prefetch={false}
            aria-current={path === current ? 'step' : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <p>
        Review evidence first. Approving an alternative does not finalize a roster or send a
        message. Share only approved feedback; private notes stay private.
      </p>
    </aside>
  );
}
