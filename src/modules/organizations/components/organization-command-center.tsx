import { ArrowRight, CalendarDays, ClipboardCheck, Plus, Trophy, Users } from 'lucide-react';
import Link from 'next/link';
import { Metric } from '../../../components/ui/metric';
import { LinkButton } from '../../../components/ui/link-button';
import { StatusBadge } from '../../../components/ui/status-badge';
import type { OrganizationDashboardProjection } from '../application/onboarding-progress';
import type { HomeRecommendation, HomeTask } from '../application/home-work';
import { DashboardActivity, type DashboardActivityData } from './dashboard-activity';
import { OnboardingChecklist } from './onboarding-checklist';

export function OrganizationCommandCenter({
  organizationSlug,
  organizationName = 'Your workspace',
  projection,
  activity,
  recommendation = { kind: 'unavailable' },
  tasks = [],
  tasksUnavailable = false,
  showManagementActions = false,
  canScore = false,
}: {
  organizationSlug?: string;
  organizationName?: string;
  projection?: OrganizationDashboardProjection | null;
  activity?: DashboardActivityData;
  recommendation?: HomeRecommendation;
  tasks?: readonly HomeTask[];
  tasksUnavailable?: boolean;
  showManagementActions?: boolean;
  canScore?: boolean;
}) {
  const base = organizationSlug && showManagementActions ? `/app/${organizationSlug}` : null;
  if (!base) {
    return (
      <div className="workspace-stack home-workspace">
        <header className="home-heading">
          <div>
            <p className="eyebrow">{organizationName}</p>
            <h1>Your work</h1>
            <p>
              Pick up an assigned task. Your organizer controls which workspaces you can access.
            </p>
          </div>
        </header>
        {tasksUnavailable ? (
          <section className="workspace-card">
            <h2>Your work is still here</h2>
            <p role="status">Assigned work could not be loaded. Try again in a moment.</p>
            <Link
              className="button-secondary inline-flex min-h-11 items-center"
              href={`/app/${organizationSlug}/home`}
              prefetch={false}
            >
              Try again
            </Link>
          </section>
        ) : tasks.length ? (
          <section aria-labelledby="assigned-work-heading" className="home-next">
            <p className="eyebrow">Assigned to you</p>
            <h2 id="assigned-work-heading">Ready when you are</h2>
            <ul className="home-task-list">
              {tasks.map((task) => (
                <li key={task.href}>
                  <Link href={task.href} prefetch={false}>
                    <span>
                      <strong>{task.label}</strong>
                      <small>{task.description}</small>
                    </span>
                    <ArrowRight size={18} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section className="workspace-card">
            <h2>No tasks assigned yet</h2>
            <p>
              Ask your organizer to assign you to a tryout or session. Your work will appear here
              once access is granted.
            </p>
          </section>
        )}
      </div>
    );
  }
  const journey = recommendation.kind === 'journey' ? recommendation.journey : null;
  const next = journey?.stages.find((stage) => stage.id === journey.nextStage);
  return (
    <div className="workspace-stack home-workspace">
      <header className="home-heading">
        <div>
          <p className="eyebrow">{organizationName}</p>
          <h1>Your tryout workspace</h1>
          <p>Continue your work, see what needs attention, and keep your tryouts moving.</p>
        </div>
        {recommendation.kind !== 'first-tryout' && (
          <Link
            className="button-secondary inline-flex min-h-11 items-center gap-2"
            href={`${base}/tryouts/new`}
            prefetch={false}
          >
            <Plus size={16} aria-hidden="true" />
            Create another tryout
          </Link>
        )}
      </header>
      <section className="home-next" aria-label="Your next action">
        {journey && next ? (
          <>
            <div className="home-next-context">
              <p className="eyebrow">Continue recent work</p>
              <StatusBadge status={journey.tryout.status}>{journey.tryout.status}</StatusBadge>
            </div>
            <h2>{journey.tryout.name}</h2>
            <p className="home-next-task">{next.title}</p>
            <p>{next.supportingText}</p>
            {next.blocker && <p className="home-next-warning">{next.blocker}</p>}
            <div className="home-next-actions">
              <LinkButton href={journey.primaryAction.href}>
                {journey.primaryAction.label}
                <ArrowRight size={18} aria-hidden="true" />
              </LinkButton>
              <Link href={`${base}/tryouts/${journey.tryout.id}/overview`} prefetch={false}>
                View tryout overview
              </Link>
            </div>
          </>
        ) : recommendation.kind === 'first-tryout' ? (
          <>
            <p className="eyebrow">Start here</p>
            <h2>Set up your first tryout</h2>
            <p>
              Save a draft before you publish. Add your divisions, sessions and scoring criteria at
              your own pace.
            </p>
            <div className="home-next-actions">
              <LinkButton href={`${base}/tryouts/new`}>
                Create your first tryout
                <ArrowRight size={18} aria-hidden="true" />
              </LinkButton>
              <Link href="/demo">Try the sample event</Link>
            </div>
            <p className="home-next-note">
              Publishing requires eligible Pro access, which may include a trial or event pass.
              Creating a draft does not start a purchase.
            </p>
          </>
        ) : recommendation.kind === 'results' ? (
          <>
            <p className="eyebrow">Completed tryout</p>
            <h2>{recommendation.name}</h2>
            <p>Your results remain available. Open reports to review this tryout.</p>
            <LinkButton href={recommendation.href}>View results &amp; exports</LinkButton>
          </>
        ) : recommendation.kind === 'history' ? (
          <>
            <p className="eyebrow">Your next season</p>
            <h2>Your previous work is here</h2>
            <p>Review previous tryouts or create a draft for your next event.</p>
            <LinkButton href={`${base}/tryouts`}>View your tryouts</LinkButton>
          </>
        ) : (
          <>
            <p className="eyebrow">Continue your work</p>
            <h2>Your workspace is available</h2>
            <p role="status">
              Current work could not be loaded. Open tryouts to find your saved events or try again.
            </p>
            <LinkButton href={`${base}/tryouts`}>Open tryouts</LinkButton>
          </>
        )}
      </section>
      {journey && (
        <section className="home-event-progress" aria-labelledby="current-event-progress-heading">
          <header>
            <h2 id="current-event-progress-heading">For this tryout</h2>
            <p>Progress for {journey.tryout.name}, separate from your program history.</p>
          </header>
          <ul>
            {journey.stages.map((stage) => (
              <li key={stage.id}>
                <div>
                  <strong>{stage.title}</strong>
                  <p>{stage.supportingText}</p>
                </div>
                <StatusBadge status={stage.status}>{stage.status.replaceAll('-', ' ')}</StatusBadge>
                <Link
                  href={stage.primaryAction.href}
                  prefetch={false}
                  aria-label={`${stage.primaryAction.label}: ${stage.title}`}
                >
                  Open
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {activity && organizationSlug && recommendation.kind !== 'first-tryout' && (
        <div className="home-recent">
          <DashboardActivity data={activity} organizationSlug={organizationSlug} />
        </div>
      )}
      <details className="home-program-history" aria-label="Program totals and milestones">
        <summary>Program totals and milestones</summary>
        <p>Across all tryouts. These totals do not measure readiness for the current event.</p>
        {projection ? (
          <>
            <section aria-label="Program totals" className="metric-grid">
              <Metric
                icon={<Users size={22} />}
                label="Active staff assignments"
                value={projection.facts.activeStaffCount}
              />
              <Metric
                icon={<CalendarDays size={22} />}
                label="Sessions"
                value={projection.facts.sessionCount}
              />
              <Metric
                icon={<ClipboardCheck size={22} />}
                label="Evaluations complete"
                value={projection.facts.completedEvaluationCount}
              />
              <Metric
                icon={<Trophy size={22} />}
                label="Finalized rosters"
                value={projection.facts.finalizedRosterCount}
              />
            </section>
            <OnboardingChecklist
              organizationSlug={organizationSlug}
              progress={projection.progress}
            />
          </>
        ) : (
          <p role="status">
            Program totals are temporarily unavailable. Your saved tryouts remain accessible.
          </p>
        )}
      </details>
    </div>
  );
}
