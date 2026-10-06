import {
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Plus,
  Trophy,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { Metric } from '../../../components/ui/metric';
import { LinkButton } from '../../../components/ui/link-button';
import type { OrganizationDashboardProjection } from '../application/onboarding-progress';
import { DashboardActivity, type DashboardActivityData } from './dashboard-activity';
import { OnboardingChecklist } from './onboarding-checklist';

export function OrganizationCommandCenter({
  organizationSlug,
  projection,
  activity,
  showManagementActions = false,
}: {
  organizationSlug?: string;
  projection: OrganizationDashboardProjection;
  activity?: DashboardActivityData;
  showManagementActions?: boolean;
}) {
  const base = organizationSlug && showManagementActions ? `/app/${organizationSlug}` : null;
  return (
    <div className="workspace-stack dashboard-workspace">
      <header className="arena-hero">
        <div className="arena-hero-copy">
          <span className="arena-overline">
            <span aria-hidden="true" /> YOUR PROGRAM. YOUR NEXT CHAPTER.
          </span>
          <h1>
            Welcome back,
            <br />
            <em>Coach.</em>
          </h1>
          <p>Big potential. Better decisions. Give every athlete their moment.</p>
          {base && (
            <LinkButton href={`${base}/tryouts/new`}>
              <Plus size={18} aria-hidden="true" />
              Create Tryout
            </LinkButton>
          )}
        </div>
        <div className="arena-hero-art" aria-hidden="true">
          <Image
            className="arena-hero-photo"
            src="/images/team-training.jpg"
            alt=""
            fill
            sizes="(max-width: 639px) 100vw, (max-width: 1023px) 45vw, 38vw"
            preload
          />
          <span className="arena-photo-tag">EVERY ATHLETE. EVERY OPPORTUNITY.</span>
        </div>
      </header>
      <section aria-label="Organization performance metrics" className="metric-grid">
        <Metric
          icon={<Users size={22} />}
          detail="Active assignments"
          label="Staff ready"
          value={projection.facts.activeStaffCount}
        />
        <Metric
          icon={<CalendarDays size={22} />}
          tone="green"
          detail="Scheduled events"
          label="Sessions"
          value={projection.facts.sessionCount}
        />
        <Metric
          icon={<ClipboardCheck size={22} />}
          detail="Completed scorecards"
          label="Evaluations complete"
          value={projection.facts.completedEvaluationCount}
        />
        <Metric
          icon={<Trophy size={22} />}
          tone="orange"
          detail="Confirmed team rosters"
          label="Finalized rosters"
          value={projection.facts.finalizedRosterCount}
        />
      </section>
      <div className="dashboard-columns">
        <div className="dashboard-support">
          {showManagementActions && activity && organizationSlug && (
            <DashboardActivity data={activity} organizationSlug={organizationSlug} />
          )}
          <OnboardingChecklist organizationSlug={organizationSlug} progress={projection.progress} />
        </div>
        <div className="dashboard-support">
          {base && (
            <section className="card dashboard-actions" aria-labelledby="quick-actions-heading">
              <h2 id="quick-actions-heading">Quick actions</h2>
              <p>Keep your program moving.</p>
              <div>
                {[
                  { label: 'Manage tryouts', path: 'tryouts', icon: ClipboardList },
                  { label: 'View athletes', path: 'athletes', icon: Users },
                  { label: 'Manage evaluators', path: 'evaluators', icon: ClipboardCheck },
                  { label: 'View reports', path: 'reports', icon: Trophy },
                ].map(({ label, path, icon: Icon }) => (
                  <Link href={`${base}/${path}`} key={path} prefetch={false}>
                    <Icon size={18} aria-hidden="true" />
                    <span>{label}</span>
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </section>
          )}
          <section className="dashboard-team-note" aria-label="Build your program">
            <span className="eyebrow">Built for a stronger tomorrow</span>
            <h2>
              More opportunity.
              <br />
              <span>Stronger teams.</span>
            </h2>
            <p>
              Bring your people together, give every athlete a fair look, and make your next
              decision with confidence.
            </p>
            {base && (
              <Link href={`${base}/tryouts`} prefetch={false}>
                Explore your tryouts <ArrowRight size={16} aria-hidden="true" />
              </Link>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
