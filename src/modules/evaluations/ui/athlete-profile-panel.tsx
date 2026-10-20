'use client';

import { FeedbackButton } from '@/components/ui/button';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Activity, CheckCheck, ChevronDown, RefreshCw } from 'lucide-react';
import { profileTotal } from '../domain/profile-total';
import type { ProfileAverage, ProfileScore } from '../domain/athlete-profile';
import type { EvaluatorCategory } from './evaluation-form';
import { AthleteRadarChart } from './athlete-radar-chart';

const desktopQuery = '(min-width: 1024px)';
function subscribeDesktop(onChange: () => void) {
  if (!window.matchMedia) return () => {};
  const media = window.matchMedia(desktopQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
function desktopSnapshot() {
  return window.matchMedia?.(desktopQuery).matches ?? false;
}

export function AthleteProfilePanel({
  athleteName,
  categories,
  scores,
  completed,
  note,
  loadAverage,
  profileScope = athleteName,
}: {
  athleteName: string;
  profileScope?: string;
  categories: EvaluatorCategory[];
  scores: ProfileScore[];
  completed: boolean;
  note: string;
  loadAverage?: () => Promise<ProfileAverage | null>;
}) {
  const desktop = useSyncExternalStore(subscribeDesktop, desktopSnapshot, () => false);
  const [view, setView] = useState<'mine' | 'average'>('mine');
  const [response, setResponse] = useState<{
    loader: typeof loadAverage;
    scope: string;
    refresh: number;
    average: ProfileAverage | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const conceal = () => {
      setResponse(null);
      setView('mine');
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') conceal();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', conceal);
    window.addEventListener('pageshow', conceal);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', conceal);
      window.removeEventListener('pageshow', conceal);
    };
  }, []);
  useEffect(() => {
    if (view !== 'average' || !loadAverage || !completed) {
      setResponse(null);
      return;
    }
    let active = true;
    setLoading(true);
    setFailed(false);
    Promise.resolve()
      .then(loadAverage)
      .then((result) => {
        if (active) {
          setResponse({ loader: loadAverage, scope: profileScope, refresh, average: result });
          setFailed(result === null);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [view, loadAverage, completed, refresh, profileScope]);
  // A stale response must never render during navigation, reopening or refresh.
  // The RPC is the authority; local completion only enables requesting proof.
  const peerView = view === 'average' && completed && Boolean(loadAverage);
  const average =
    peerView &&
    response &&
    response.loader === loadAverage &&
    response.scope === profileScope &&
    response.refresh === refresh
      ? response.average
      : null;
  const total = profileTotal(categories, scores);
  const observedCount = categories.filter((category) =>
    scores.some(
      (score) =>
        score.categoryId === category.id &&
        Number.isInteger(score.value) &&
        score.value >= category.scaleMin &&
        score.value <= category.scaleMax,
    ),
  ).length;
  return (
    <aside className="athlete-profile-panel min-w-0 self-start">
      <details
        open={desktop || expanded || completed}
        onToggle={(event) => {
          if (!desktop) setExpanded(event.currentTarget.open);
        }}
      >
        <summary className="profile-disclosure">
          <span className="profile-title">
            <Activity size={18} aria-hidden="true" />
            Athlete Profile
          </span>
          <span className="profile-disclosure-meta">
            {observedCount}/{categories.length}
            <ChevronDown size={16} aria-hidden="true" />
          </span>
        </summary>
        <div className="athlete-profile-content min-w-0">
          <div className="profile-athlete">
            <span className="profile-kicker">
              {completed ? 'Final scorecard' : 'Every strength. Every opportunity.'}
            </span>
            <p>{athleteName}</p>
          </div>
          <div className="profile-switch" aria-label="Profile view">
            <FeedbackButton
              type="button"
              aria-pressed={!peerView}
              onClick={() => {
                setResponse(null);
                setView('mine');
              }}
              className="profile-switch-button"
            >
              My Evaluation
            </FeedbackButton>
            {loadAverage && (
              <FeedbackButton
                type="button"
                aria-pressed={peerView}
                disabled={!completed}
                onClick={() => {
                  setResponse(null);
                  setLoading(true);
                  setView('average');
                }}
                className="profile-switch-button"
              >
                Evaluator Average
              </FeedbackButton>
            )}
          </div>
          {loadAverage && !completed && (
            <p className="profile-explainer">
              Submit your evaluation before viewing evaluator averages. Drafts and reopened
              evaluations stay blind.
            </p>
          )}
          {!peerView ? (
            <>
              <div className="profile-scoreboard">
                <div>
                  <span className="profile-kicker">Overall score</span>
                  <p
                    className="profile-total"
                    data-testid="profile-overall"
                    data-value={total ?? ''}
                    title={total ? `Exact weighted score: ${total}` : undefined}
                  >
                    <strong>{total === null ? '—' : Number(total).toFixed(1)}</strong>{' '}
                    <span>{total === null ? 'Pending' : '/ 100'}</span>
                  </p>
                </div>
                <span className="profile-state">
                  {completed ? (
                    <CheckCheck size={16} aria-hidden="true" />
                  ) : (
                    <Activity size={16} aria-hidden="true" />
                  )}
                  {completed ? 'Complete' : 'Live profile'}
                </span>
              </div>
              <p className="profile-explainer">
                {total === null
                  ? 'Your weighted total appears when all criteria are scored.'
                  : 'Calculated using the weights in this evaluation form.'}
              </p>
              <AthleteRadarChart criteria={categories} scores={scores} athleteName={athleteName} />
              {completed && (
                <div className="profile-notes">
                  <h3 className="text-sm font-bold">Your evaluator notes</h3>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {note || 'No notes recorded.'}
                  </p>
                </div>
              )}
            </>
          ) : loading ? (
            <p>Loading evaluator average…</p>
          ) : failed ? (
            <p>Evaluator average is unavailable. Your evaluation is still available.</p>
          ) : average ? (
            <>
              <p className="mb-3 text-xs text-[var(--color-text-muted)]">
                {average.evaluationCount} completed evaluations · same session and form version.
                Unanswered criteria are excluded. Refreshed when opened.
              </p>
              <AthleteRadarChart
                criteria={categories}
                scores={average.scores}
                athleteName="Evaluator Average"
              />
              <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                {categories
                  .map(
                    (category) =>
                      `${category.name}: ${average.scores.find((score) => score.categoryId === category.id)?.count ?? 0} scores`,
                  )
                  .join(' · ')}
              </p>
            </>
          ) : null}
          {peerView && (
            <FeedbackButton
              type="button"
              disabled={loading}
              onClick={() => {
                setResponse(null);
                setLoading(true);
                setRefresh((value) => value + 1);
              }}
              className="profile-refresh"
            >
              <RefreshCw size={14} aria-hidden="true" /> Refresh average
            </FeedbackButton>
          )}
        </div>
      </details>
    </aside>
  );
}
