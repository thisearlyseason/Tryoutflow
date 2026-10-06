import { z } from 'zod';

export const DEMO_DURATION_MS = 30 * 60 * 1000;
export const DEMO_STORAGE_KEY = 'tryoutflow.interactive-demo.v1';
export const DEMO_CRITERIA = ['Skating', 'Puck control', 'Teamwork'] as const;
const score = z.number().int().min(1).max(5).nullable();
const athleteSchema = z.object({
  id: z.number().int().min(1).max(24),
  checkedIn: z.boolean(),
  scores: z.tuple([score, score, score]),
  notes: z.string().max(500),
  selected: z.boolean(),
});
const stateSchema = z
  .object({
    version: z.literal(1),
    startedAt: z.number().finite().nonnegative(),
    expiresAt: z.number().finite().nonnegative(),
    eventName: z.string().min(1).max(80),
    athletes: z.array(athleteSchema).min(1).max(24),
  })
  .refine(
    (state) =>
      state.expiresAt - state.startedAt === DEMO_DURATION_MS &&
      new Set(state.athletes.map((athlete) => athlete.id)).size === state.athletes.length,
  );

export type DemoState = z.infer<typeof stateSchema>;
export type DemoAthlete = DemoState['athletes'][number];
export type DemoAction =
  | { type: 'check-in'; id: number }
  | { type: 'score'; id: number; criterion: number; value: number }
  | { type: 'notes'; id: number; value: string }
  | { type: 'select'; id: number }
  | { type: 'rename'; value: string }
  | { type: 'add-athlete' };

export function createDemo(now: number): DemoState {
  const scores: DemoAthlete['scores'][] = [
    [4, 4, 5],
    [3, 4, 4],
    [5, 4, 4],
    [4, 3, 4],
    [3, 3, 5],
    [4, 5, 5],
    [null, null, null],
    [3, null, null],
  ];
  return {
    version: 1,
    startedAt: now,
    expiresAt: now + DEMO_DURATION_MS,
    eventName: 'U15 Hockey · Fall Tryouts',
    athletes: scores.map((values, index) => ({
      id: index + 1,
      checkedIn: index < 6,
      scores: [...values],
      notes: index === 0 ? 'Sample note: communicates well during the passing drill.' : '',
      selected: index === 0 || index === 5,
    })),
  };
}

export function demoExpired(state: DemoState, now: number) {
  return now >= state.expiresAt || now < state.startedAt;
}

export function readDemo(raw: string | null, now: number): DemoState {
  try {
    const result = stateSchema.safeParse(JSON.parse(raw ?? 'null'));
    if (result.success && !demoExpired(result.data, now)) return result.data;
  } catch {
    /* Invalid browser data is replaced by the original sample. */
  }
  return createDemo(now);
}

export function updateDemo(state: DemoState, action: DemoAction, now: number): DemoState {
  // An action from an expired screen must never write old data into a fresh session.
  if (demoExpired(state, now)) return createDemo(now);
  if (action.type === 'rename') {
    const name = action.value.trim().slice(0, 80);
    return name ? { ...state, eventName: name } : state;
  }
  if (action.type === 'add-athlete') {
    const id = Math.max(...state.athletes.map((a) => a.id)) + 1;
    if (id > 24) return state;
    return {
      ...state,
      athletes: [
        ...state.athletes,
        { id, checkedIn: false, scores: [null, null, null], notes: '', selected: false },
      ],
    };
  }
  return {
    ...state,
    athletes: state.athletes.map((athlete) => {
      if (athlete.id !== action.id) return athlete;
      if (action.type === 'check-in') return { ...athlete, checkedIn: !athlete.checkedIn };
      if (action.type === 'select') return { ...athlete, selected: !athlete.selected };
      if (action.type === 'notes') return { ...athlete, notes: action.value.slice(0, 500) };
      if (
        !Number.isInteger(action.criterion) ||
        action.criterion < 0 ||
        action.criterion > 2 ||
        !Number.isInteger(action.value) ||
        action.value < 1 ||
        action.value > 5
      )
        return athlete;
      const scores: DemoAthlete['scores'] = [...athlete.scores];
      scores[action.criterion] = action.value;
      return { ...athlete, scores };
    }),
  };
}

export function athleteName(id: number) {
  return `Demo Athlete ${String(id).padStart(2, '0')}`;
}
export function completeScore(athlete: DemoAthlete): number | null {
  return athlete.scores.some((value) => value === null)
    ? null
    : athlete.scores.reduce<number>((sum, value) => sum + value!, 0);
}
export function demoRankings(athletes: DemoAthlete[]) {
  const completed = athletes
    .filter((a) => completeScore(a) !== null)
    .sort((a, b) => completeScore(b)! - completeScore(a)! || a.id - b.id);
  return completed.map((athlete, index) => ({
    athlete,
    rank: completed.findIndex((a) => completeScore(a) === completeScore(athlete)) + 1,
    average: (completeScore(athlete)! / 3).toFixed(2),
    tied: completed.some(
      (other, otherIndex) =>
        otherIndex !== index && completeScore(other) === completeScore(athlete),
    ),
  }));
}
