import type { TryoutJourney } from '@/modules/tryouts/application/load-tryout-journey';
import { flattenNavigation, type NavigationGroup } from '../components/app-navigation-model';

export type HomeRecommendation =
  | { kind: 'first-tryout' | 'history' | 'unavailable' }
  | { kind: 'journey'; journey: TryoutJourney }
  | { kind: 'results'; name: string; href: string };

export type HomeTask = { label: string; href: string; description: string };

/** An unknown read is different from a genuinely empty workspace. */
export async function recommendHomeWork(
  activeTryout: { id: string } | null | undefined,
  recentCount: number | null,
  loadJourney: (id: string) => Promise<TryoutJourney>,
): Promise<HomeRecommendation> {
  if (activeTryout === undefined) return { kind: 'unavailable' };
  if (activeTryout) {
    try {
      return { kind: 'journey', journey: await loadJourney(activeTryout.id) };
    } catch {
      return { kind: 'unavailable' };
    }
  }
  if (recentCount === null) return { kind: 'unavailable' };
  return { kind: recentCount ? 'history' : 'first-tryout' };
}

export function buildHomeTasks(
  groups: readonly NavigationGroup[],
  tryoutNames: ReadonlyMap<string, string> = new Map(),
): HomeTask[] {
  const priority = (href: string) => {
    if (href.endsWith('/evaluate')) return 0;
    if (href.endsWith('/check-in')) return 1;
    if (href.endsWith('/live')) return 2;
    if (href.endsWith('/rankings')) return 3;
    return 4;
  };
  const labels: Record<string, string> = {
    Evaluate: 'Evaluate athletes',
    'Check-in': 'Check in athletes',
    Live: 'Run your tryout',
    Rankings: 'Review rankings',
  };
  const seen = new Set<string>();
  return flattenNavigation(groups)
    .filter(({ href }) => !seen.has(href) && Boolean(seen.add(href)))
    .sort((a, b) => priority(a.href) - priority(b.href))
    .map((item) => {
      const tryoutId = /\/tryouts\/([^/]+)\//u.exec(item.href)?.[1];
      return {
        label: labels[item.label] ?? item.label,
        href: item.href,
        description: tryoutId
          ? (tryoutNames.get(tryoutId) ?? 'Your assigned tryout')
          : item.href.endsWith('/evaluate')
            ? 'Your assigned sessions'
            : 'Your authorized workspace',
      };
    });
}
