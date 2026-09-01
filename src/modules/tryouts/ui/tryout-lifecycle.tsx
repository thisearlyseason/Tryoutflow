import Link from 'next/link';

export const tryoutLifecycleStages = [
  'draft',
  'published',
  'registration',
  'evaluation',
  'decisions',
  'finalized',
] as const;

export type TryoutLifecycleStage = (typeof tryoutLifecycleStages)[number];

const labels: Record<TryoutLifecycleStage, string> = {
  draft: 'Draft',
  published: 'Published',
  registration: 'Registration',
  evaluation: 'Evaluation',
  decisions: 'Decisions',
  finalized: 'Finalized',
};

export function TryoutLifecycle({
  completed = [],
  counts,
  current,
  hrefs,
}: {
  completed?: readonly TryoutLifecycleStage[];
  counts?: Partial<Record<TryoutLifecycleStage, number>>;
  current: TryoutLifecycleStage;
  hrefs: Partial<Record<TryoutLifecycleStage, string>>;
}) {
  return (
    <nav aria-label="Tryout progress" className="tryout-lifecycle">
      <ol aria-label="Tryout lifecycle">
        {tryoutLifecycleStages.flatMap((stage, index) => {
          const href = hrefs[stage];
          if (!href) return [];
          const isComplete = completed.includes(stage);
          return [
            <li key={stage}>
              <Link
                aria-current={stage === current ? 'step' : undefined}
                className={
                  stage === current ? 'lifecycle-link lifecycle-current' : 'lifecycle-link'
                }
                data-complete={isComplete ? 'true' : undefined}
                href={href}
                prefetch={false}
              >
                <span aria-hidden="true" className="lifecycle-index">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>{labels[stage]}</span>
                {counts?.[stage] !== undefined ? (
                  <strong aria-label={`${counts[stage]} ${labels[stage].toLowerCase()}`}>
                    {counts[stage]}
                  </strong>
                ) : null}
              </Link>
            </li>,
          ];
        })}
      </ol>
    </nav>
  );
}
