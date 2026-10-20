import type { SingleTryoutLifecycle } from '../application/single-tryout-lifecycle';

export function SingleTryoutNotice({ lifecycle }: { lifecycle: SingleTryoutLifecycle }) {
  if (!lifecycle.single) return null;
  const deadline = lifecycle.locksAt
    ? new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(new Date(lifecycle.locksAt)) + ' UTC'
    : null;
  return (
    <aside className="card p-5" aria-label="Single Tryout license">
      <h2 className="text-lg font-bold">
        {lifecycle.locked ? 'Tryout locked · results preserved' : 'One purchase. One tryout.'}
      </h2>
      <p className="mt-2 text-sm">
        {lifecycle.locked
          ? 'This event is read-only. Scores, registrations, rosters and setup cannot be changed or reopened. You can still view and export your results. A new event needs its own purchase or a subscription.'
          : lifecycle.sealed
            ? `The event identity, divisions and schedule are fixed. Finish scores, selections and messages by ${deadline}, when editing locks automatically. Complete & lock closes editing immediately.`
            : 'Before publishing, finalize the event name, season, divisions, registration dates and session schedule. Sessions must fit within 14 days. Editing locks 7 days after the last session, or earlier when you complete the tryout.'}
      </p>
    </aside>
  );
}
