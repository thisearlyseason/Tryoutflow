'use client';

import { FeedbackButton } from '@/components/ui/button';

import Link from 'next/link';
import { useState } from 'react';
import { ClipboardCheck, Clock3, ListOrdered, RotateCcw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScoreControl } from '@/modules/evaluations/ui/score-control';
import {
  athleteName,
  completeScore,
  DEMO_CRITERIA,
  demoRankings,
  type DemoState,
} from './demo-state';
import { useDemo } from './use-demo';

const views = ['Overview', 'Check-in', 'Evaluate', 'Rankings', 'Roster'] as const;
type View = (typeof views)[number];
const card = 'rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-6';

export function DemoWorkspace() {
  const demo = useDemo();
  if (!demo.state)
    return (
      <p className="p-8" role="status">
        Preparing your sample tryout…
      </p>
    );
  return <DemoWorkspaceContent key={demo.state.startedAt} {...demo} state={demo.state} />;
}

function DemoWorkspaceContent({
  state,
  now,
  notice,
  persistent,
  change,
  reset,
}: Omit<ReturnType<typeof useDemo>, 'state'> & { state: DemoState }) {
  const [view, setView] = useState<View>('Overview');
  const [selectedId, setSelectedId] = useState(7);
  const [search, setSearch] = useState('');
  const seconds = Math.max(0, Math.ceil((state.expiresAt - now) / 1000));
  const remaining = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const athletes = state.athletes;
  const selected = athletes.find((a) => a.id === selectedId) ?? athletes[0]!;
  const rankings = demoRankings(athletes);
  const roster = athletes.filter((a) => a.selected);
  const visible = athletes.filter((a) =>
    `${athleteName(a.id)} ${a.id + 10}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[var(--color-text)] p-4 text-white">
        <div>
          <p className="font-black">Your hands-on demo workspace</p>
          <p className="mt-1 text-sm text-white/80">
            Preloaded sample data · No sign-up · Resets every 30 minutes
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="flex items-center gap-2 font-mono text-lg"
            aria-label={`Demo resets in ${Math.floor(seconds / 60)} minutes and ${seconds % 60} seconds`}
          >
            <Clock3 size={18} aria-hidden="true" />{' '}
            <span data-testid="demo-countdown">{remaining}</span>
          </span>
          <Button variant="secondary" onClick={reset}>
            <RotateCcw size={16} aria-hidden="true" /> Reset demo
          </Button>
        </div>
      </div>
      <header className="my-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-[var(--color-primary)]">
            TryoutFlow / Demo club
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{state.eventName}</h1>
          <p className="mt-2 text-[var(--color-text-muted)]">
            Try a check-in, score an athlete, then build your team.
          </p>
        </div>
        <Link
          href="/start?plan=pro"
          className="inline-flex min-h-12 items-center rounded-xl bg-[var(--color-primary)] px-5 font-bold text-white"
        >
          Create my own workspace
        </Link>
      </header>
      <nav aria-label="Demo workspace" className="mb-6 flex flex-wrap gap-2">
        {views.map((item) => (
          <Button
            key={item}
            variant={view === item ? 'primary' : 'secondary'}
            aria-pressed={view === item}
            onClick={() => setView(item)}
          >
            {item}
          </Button>
        ))}
      </nav>
      <p role="status" className="mb-4 min-h-6 text-sm text-[var(--color-text-muted)]">
        {notice || 'Your changes stay in this browser and are cleared at the next reset.'}
      </p>
      {!persistent && (
        <p className="mb-4 text-sm">
          Browser storage is unavailable. You can still try the demo; reloading will start fresh.
        </p>
      )}

      {view === 'Overview' && (
        <section aria-label="Demo overview" className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: 'Registered athletes', value: athletes.length, icon: Users },
              {
                label: 'Checked in',
                value: athletes.filter((a) => a.checkedIn).length,
                icon: ClipboardCheck,
              },
              { label: 'Complete evaluations', value: rankings.length, icon: ListOrdered },
              { label: 'On your roster', value: roster.length, icon: Users },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className={card}>
                <Icon size={21} aria-hidden="true" />
                <p className="mt-3 text-3xl font-black">{value}</p>
                <p className="mt-1 text-sm">{label}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className={card}>
              <h2 className="text-xl font-black">A tryout ready to explore</h2>
              <p className="my-3 text-[var(--color-text-muted)]">
                Your sample U15 hockey event includes registrations, athlete numbers, a
                three-criterion rubric, saved evaluations and a draft roster.
              </p>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <dt>Division</dt>
                <dd>U15 · Open</dd>
                <dt>Session</dt>
                <dd>Skills evaluation · 5:00–6:30 PM</dd>
                <dt>Venue</dt>
                <dd>Demo Arena · Rink 1</dd>
                <dt>Rubric</dt>
                <dd>Skating, puck control, teamwork</dd>
              </dl>
              <form
                className="mt-5 space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  change({ type: 'rename', value: String(form.get('eventName')) });
                }}
              >
                <label className="block text-sm font-bold" htmlFor="demo-event-name">
                  Try renaming the event
                </label>
                <Input
                  key={`${state.startedAt}:${state.eventName}`}
                  id="demo-event-name"
                  name="eventName"
                  defaultValue={state.eventName}
                  maxLength={80}
                  required
                />
                <Button type="submit" variant="secondary">
                  Save event name
                </Button>
              </form>
            </div>
            <div className={card}>
              <h2 className="text-xl font-black">Try the complete flow</h2>
              <ol className="my-5 space-y-4">
                <li>
                  <strong>1. Check in an athlete.</strong>
                  <p>
                    {athletes.find((athlete) => athlete.id === 7)?.checkedIn
                      ? 'Demo Athlete 07 is checked in. Try entering their scores next.'
                      : 'Demo Athlete 07 is still waiting to arrive.'}
                  </p>
                </li>
                <li>
                  <strong>2. Enter three scores.</strong>
                  <p>
                    Use the same scoring controls as the app. Your completed evaluation appears in
                    rankings.
                  </p>
                </li>
                <li>
                  <strong>3. Review and select.</strong>
                  <p>Compare scores and add athletes to your draft roster.</p>
                </li>
              </ol>
              <Button onClick={() => setView('Check-in')}>Start with check-in</Button>
            </div>
          </div>
        </section>
      )}

      {view === 'Check-in' && (
        <section aria-label="Demo check-in" className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-black">Check-in desk</h2>
            <Button
              variant="secondary"
              disabled={athletes.length >= 24}
              onClick={() => change({ type: 'add-athlete' })}
            >
              Add sample registration
            </Button>
          </div>
          <label className="mt-5 block text-sm font-bold" htmlFor="demo-athlete-search">
            Find athlete or number
          </label>
          <Input
            id="demo-athlete-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Try 07 or athlete number 17"
            className="my-2"
          />
          <ul className="divide-y divide-[var(--color-border)]">
            {visible.map((athlete) => (
              <li
                key={athlete.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4"
              >
                <div>
                  <p className="font-bold">{athleteName(athlete.id)}</p>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    #{athlete.id + 10} · U15 · {athlete.checkedIn ? 'Checked in' : 'Not arrived'}
                  </p>
                </div>
                <Button
                  variant={athlete.checkedIn ? 'secondary' : 'primary'}
                  aria-label={`${athlete.checkedIn ? 'Undo check-in for' : 'Check in'} ${athleteName(athlete.id)}`}
                  onClick={() => change({ type: 'check-in', id: athlete.id })}
                >
                  {athlete.checkedIn ? 'Undo check-in' : 'Check in'}
                </Button>
              </li>
            ))}
          </ul>
          {visible.length === 0 && <p className="py-6">No matching sample athletes.</p>}
        </section>
      )}

      {view === 'Evaluate' && (
        <section aria-label="Demo evaluation" className="grid gap-6 lg:grid-cols-[17rem_1fr]">
          <div className={card}>
            <h2 className="text-xl font-black">Your athletes</h2>
            <label className="mt-3 block text-sm font-bold lg:hidden" htmlFor="demo-score-athlete">
              Choose an athlete
            </label>
            <select
              id="demo-score-athlete"
              value={selected.id}
              onChange={(event) => setSelectedId(Number(event.target.value))}
              className="mt-2 min-h-12 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-base lg:hidden"
            >
              {athletes.map((athlete) => (
                <option key={athlete.id} value={athlete.id}>
                  {athleteName(athlete.id)} · #{athlete.id + 10}
                </option>
              ))}
            </select>
            <div className="mt-4 hidden space-y-2 lg:block">
              {athletes.map((athlete) => (
                <FeedbackButton
                  type="button"
                  key={athlete.id}
                  aria-pressed={athlete.id === selected.id}
                  onClick={() => setSelectedId(athlete.id)}
                  className={`min-h-12 w-full rounded-xl border p-3 text-left ${athlete.id === selected.id ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white' : 'border-[var(--color-border)]'}`}
                >
                  <span className="block font-bold">{athleteName(athlete.id)}</span>
                  <span className="text-xs">
                    #{athlete.id + 10} ·{' '}
                    {completeScore(athlete) === null ? 'Needs scores' : 'Complete'}
                  </span>
                </FeedbackButton>
              ))}
            </div>
          </div>
          <div className={card}>
            <h2 className="text-2xl font-black">
              {athleteName(selected.id)} · #{selected.id + 10}
            </h2>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              {selected.checkedIn ? 'Checked in' : 'Not checked in yet'} · Scores save as you choose
              them.
            </p>
            <div className="my-6 space-y-5">
              {DEMO_CRITERIA.map((criterion, index) => (
                <div key={criterion}>
                  <h3 className="mb-2 font-bold">{criterion}</h3>
                  <ScoreControl
                    categoryId={`demo-${index}`}
                    label={criterion}
                    min={1}
                    max={5}
                    value={selected.scores[index] ?? null}
                    onChange={({ score }) =>
                      change({ type: 'score', id: selected.id, criterion: index, value: score })
                    }
                  />
                </div>
              ))}
            </div>
            <label htmlFor="demo-notes" className="block font-bold">
              Evaluation notes
            </label>
            <textarea
              id="demo-notes"
              value={selected.notes}
              maxLength={500}
              onChange={(event) =>
                change({ type: 'notes', id: selected.id, value: event.target.value })
              }
              rows={3}
              className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
              placeholder="Try a sample observation…"
            />
            <p className="my-4 font-bold">
              {completeScore(selected) === null
                ? `${selected.scores.filter((s) => s !== null).length} of 3 criteria scored`
                : `Evaluation complete · Average ${(completeScore(selected)! / 3).toFixed(2)} / 5`}
            </p>
            <Button onClick={() => setView('Rankings')}>View updated rankings</Button>
          </div>
        </section>
      )}

      {view === 'Rankings' && (
        <section aria-label="Demo rankings" className={card}>
          <h2 className="text-2xl font-black">Rankings</h2>
          <p className="my-3 text-[var(--color-text-muted)]">
            {rankings.length} of {athletes.length} evaluations complete. Only complete scorecards
            are ranked. Each criterion has equal weight; ties share a rank.
          </p>
          <ol className="divide-y divide-[var(--color-border)]">
            {rankings.map(({ athlete, rank, average, tied }) => (
              <li key={athlete.id} className="flex flex-wrap items-center gap-4 py-4">
                <span
                  className="w-12 text-center text-2xl font-black"
                  aria-label={`Rank ${rank}${tied ? ', tied' : ''}`}
                >
                  {rank}
                  {tied ? '=' : ''}
                </span>
                <div className="mr-auto">
                  <p className="font-bold">{athleteName(athlete.id)}</p>
                  <p className="text-sm">
                    #{athlete.id + 10} · {average} / 5 · 3/3 criteria
                  </p>
                </div>
                <Button
                  variant={athlete.selected ? 'secondary' : 'primary'}
                  aria-label={`${athlete.selected ? 'Remove' : 'Select'} ${athleteName(athlete.id)}`}
                  onClick={() => change({ type: 'select', id: athlete.id })}
                >
                  {athlete.selected ? 'Remove from roster' : 'Add to roster'}
                </Button>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm">
            Unranked:{' '}
            {athletes
              .filter((a) => completeScore(a) === null)
              .map((a) => athleteName(a.id))
              .join(', ') || 'None — all evaluations complete.'}
          </p>
        </section>
      )}

      {view === 'Roster' && (
        <section aria-label="Demo roster" className="grid gap-6 lg:grid-cols-2">
          <div className={card}>
            <h2 className="text-2xl font-black">Draft roster · {roster.length} athletes</h2>
            <p className="my-3 text-[var(--color-text-muted)]">
              Choose athletes in Rankings to build your team.
            </p>
            <ul className="divide-y divide-[var(--color-border)]">
              {roster.map((athlete) => (
                <li
                  key={athlete.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <span className="font-bold">
                    #{athlete.id + 10} · {athleteName(athlete.id)}
                  </span>
                  <Button
                    variant="secondary"
                    aria-label={`Remove ${athleteName(athlete.id)}`}
                    onClick={() => change({ type: 'select', id: athlete.id })}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            {roster.length === 0 && (
              <p className="py-4">Your roster is empty. Add athletes from Rankings.</p>
            )}
            <Button onClick={() => setView('Rankings')}>Review rankings</Button>
          </div>
          <div className={card}>
            <p className="text-xs font-black uppercase tracking-widest text-[var(--color-primary)]">
              Message preview
            </p>
            <h2 className="mt-2 text-xl font-black">Your team invitation</h2>
            <p className="my-4">
              To: {roster.length} selected sample athlete{roster.length === 1 ? '' : 's'}
            </p>
            <blockquote className="rounded-xl bg-[var(--color-surface-muted)] p-4">
              Thank you for taking part in {state.eventName}. We would like to invite you to join
              our team. Please review your invitation with your guardian.
            </blockquote>
            <p className="mt-4 text-sm text-[var(--color-text-muted)]">
              Preview only. The demo never emails anyone or publishes real selection decisions.
            </p>
          </div>
        </section>
      )}
      <p className="my-6 text-sm text-[var(--color-text-muted)]">
        All athletes and event details are fictional. Explore with sample information. Your demo
        resets automatically after 30 minutes, including saved scores, notes, registrations and
        roster choices.
      </p>
    </div>
  );
}
