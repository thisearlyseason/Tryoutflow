import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  ClipboardCheck,
  Layers3,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  WifiOff,
} from 'lucide-react';

import { marketingMetadata } from '../../modules/marketing/content/metadata';
import {
  LandingReveal,
  ScoringPreview,
  WorkflowExplorer,
} from '../../modules/marketing/ui/landing-interactions';
import './landing.css';

export const metadata: Metadata = marketingMetadata({
  path: '/',
  title: 'TryoutFlow | Better tryouts. Better decisions.',
  description:
    'Bring registration, check-in, athlete evaluation, rankings, rosters and family communication together. See how TryoutFlow helps your team run a better tryout.',
});

const audiences = [
  {
    href: '/for/teams',
    name: 'Teams',
    number: '01',
    text: 'One event. One roster. A clear path from registration to your final team.',
    detail: 'Keep your next tryout moving.',
  },
  {
    href: '/for/clubs',
    name: 'Clubs',
    number: '02',
    text: 'Bring multiple teams and divisions into a consistent workflow with clear staff responsibilities.',
    detail: 'Give every team the same strong start.',
  },
  {
    href: '/for/associations',
    name: 'Associations',
    number: '03',
    text: 'Coordinate your program with scoped access, shared processes and a record of your decisions.',
    detail: 'Build consistency across your program.',
  },
];
const guides = [
  { audience: 'coaches', label: 'Coaches & organizers', detail: 'Set up and lead the event' },
  { audience: 'evaluators', label: 'Evaluators', detail: 'Prepare, score and finish' },
  { audience: 'parents', label: 'Parents & athletes', detail: 'Register and follow along' },
  { audience: 'checkin', label: 'Check-in staff', detail: 'Welcome every athlete' },
  { audience: 'reviewers', label: 'Reviewers', detail: 'Compare and report' },
  { audience: 'scouting', label: 'Scouting & performance', detail: 'Observe, measure and develop' },
];

export default function HomePage() {
  return (
    <LandingReveal>
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <p className="landing-kicker">
            <span className="landing-status-dot" /> Built for the people behind the team
          </p>
          <h1 id="landing-title">
            Great athletes <br />
            <span>start here.</span>
          </h1>
          <p className="landing-lead">
            See the potential. <br />
            <strong>Bring out the team.</strong>
          </p>
          <p className="landing-hero-description">
            From the first registration to the final roster, give your athletes, staff and families
            a tryout experience that moves everyone forward.
          </p>
          <div className="landing-actions">
            <Link prefetch={false} className="landing-button landing-button-blue" href="/demo">
              Try the demo <ArrowRight size={19} aria-hidden="true" />
            </Link>
            <a className="landing-button landing-button-outline" href="#workflow">
              Explore the workflow <ArrowDown size={17} aria-hidden="true" />
            </a>
          </div>
          <p className="landing-hero-note">
            <Check size={15} aria-hidden="true" /> Your sport. Your criteria. Your decisions.
          </p>
        </div>
        <div className="landing-hero-visual">
          <div className="landing-photo">
            <Image
              src="/images/tryout-training-hero.webp"
              alt="Illustrative soccer training scene with an athlete dribbling between cones"
              fill
              sizes="(min-width: 900px) 52vw, 100vw"
              preload
            />
            <div className="landing-photo-shade" />
            <span className="landing-photo-label">
              <span /> THE NEXT CHAPTER STARTS HERE
            </span>
            <div className="landing-photo-caption">
              More than a number. <br />
              <em>A world of potential.</em>
            </div>
          </div>
          <div className="landing-floating-card landing-card-top">
            <span className="landing-small-icon">
              <ClipboardCheck size={21} aria-hidden="true" />
            </span>
            <div>
              <strong>Ready for tryout day</strong>
              <span>Plan · Prepare · Play</span>
            </div>
            <Check size={18} aria-hidden="true" />
          </div>
          <div className="landing-floating-card landing-card-bottom">
            <div>
              <span className="landing-kicker">Every observation matters</span>
              <strong>See the whole athlete.</strong>
            </div>
            <div className="landing-mini-bars" aria-hidden="true">
              {[42, 65, 55, 83, 72, 94, 85].map((height, index) => (
                <i key={index} style={{ height: `${height}%` }} />
              ))}
            </div>
            <span className="landing-visual-note">Illustrative performance profile</span>
          </div>
          <span className="landing-orbit" aria-hidden="true" />
        </div>
      </section>

      <div className="landing-foundations" aria-label="Everything connected">
        <p>
          A better flow. <br />
          <strong>At every step.</strong>
        </p>
        <div>
          {[
            { icon: Users, label: 'Registration' },
            { icon: ClipboardCheck, label: 'Check-in' },
            { icon: Target, label: 'Evaluation' },
            { icon: BarChart3, label: 'Rankings' },
            { icon: Layers3, label: 'Rosters' },
            { icon: MessageSquare, label: 'Communication' },
          ].map(({ icon: Icon, label }) => (
            <span key={label}>
              <Icon size={20} aria-hidden="true" />
              {label}
            </span>
          ))}
        </div>
      </div>

      <WorkflowExplorer />

      <section className="landing-features-wrap" aria-labelledby="landing-features-title">
        <div className="landing-section">
          <div className="landing-section-heading" data-reveal>
            <div>
              <p className="landing-kicker">Made for the moments that matter</p>
              <h2 id="landing-features-title">
                Less to juggle. <br />
                More room to focus.
              </h2>
            </div>
            <Link prefetch={false} href="/features" className="landing-text-link">
              Explore all features <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
          <div className="landing-feature-grid">
            <article className="landing-feature landing-feature-score" data-reveal>
              <div className="landing-feature-copy">
                <span className="landing-feature-icon">
                  <Target aria-hidden="true" />
                </span>
                <h3>
                  Keep your eyes <br />
                  on the game.
                </h3>
                <p>
                  Clear scoring criteria and individual athlete scorecards help evaluators turn what
                  they see into useful feedback.
                </p>
                <Link
                  prefetch={false}
                  href="/how-to?audience=evaluators"
                  className="landing-text-link"
                >
                  Meet the evaluator workflow <ArrowRight size={17} aria-hidden="true" />
                </Link>
              </div>
              <ScoringPreview />
            </article>
            <article className="landing-feature landing-feature-offline" data-reveal>
              <WifiOff size={30} aria-hidden="true" />
              <h3>
                The connection can wait. <br />
                The observation can’t.
              </h3>
              <p>
                Keep working with device drafts in an already loaded scoring session. Reconnect and
                confirm the server save before finishing.
              </p>
              <div className="landing-sync-path">
                <span>
                  <i />
                  Device draft
                </span>
                <ArrowRight size={18} aria-hidden="true" />
                <span>
                  <Check size={14} aria-hidden="true" />
                  Server saved
                </span>
              </div>
              <Link
                prefetch={false}
                href="/how-to?audience=evaluators#evaluator-offline"
                className="landing-text-link"
              >
                See how saving works <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </article>
            <article className="landing-feature landing-feature-decisions" data-reveal>
              <div className="landing-feature-copy">
                <span className="landing-feature-icon">
                  <BarChart3 aria-hidden="true" />
                </span>
                <h3>
                  Confidence comes <br />
                  from context.
                </h3>
                <p>
                  See scores alongside coverage. Compare the evidence, discuss the tradeoffs, and
                  keep roster decisions in your team’s hands.
                </p>
              </div>
              <div className="landing-comparison" aria-label="Illustrative evaluation coverage">
                <div>
                  <span>Athlete 18</span>
                  <strong>3 of 3</strong>
                </div>
                <div className="landing-coverage-track">
                  <i />
                  <i />
                  <i />
                </div>
                <div>
                  <span>Athlete 31</span>
                  <strong>2 of 3</strong>
                </div>
                <div className="landing-coverage-track">
                  <i />
                  <i />
                  <i className="landing-coverage-missing" />
                </div>
                <p>
                  <ShieldCheck size={16} aria-hidden="true" />
                  Coverage stays part of the conversation.
                </p>
              </div>
            </article>
            <article className="landing-feature landing-feature-family" data-reveal>
              <div className="landing-feature-copy">
                <span className="landing-feature-icon">
                  <MessageSquare aria-hidden="true" />
                </span>
                <h3>
                  Keep families <br />
                  in the loop.
                </h3>
                <p>
                  Connect linked families with published updates, schedules, approved feedback and
                  offers in their participant portal.
                </p>
                <Link
                  prefetch={false}
                  href="/how-to?audience=parents"
                  className="landing-text-link"
                >
                  Explore the family guide <ArrowRight size={17} aria-hidden="true" />
                </Link>
              </div>
              <div className="landing-message-preview">
                <div>
                  <span className="landing-message-avatar">
                    <Users size={20} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>Ready for the next step</strong>
                    <span>Example event update</span>
                  </div>
                </div>
                <p>
                  Check your session details, bring your equipment, and get ready to show what you
                  can do.
                </p>
                <span className="landing-message-tag">One place to stay informed</span>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section
        className="landing-section landing-programs"
        aria-labelledby="built-for-heading"
        data-reveal
      >
        <div className="landing-section-heading">
          <div>
            <p className="landing-kicker">Big ambitions. Any size.</p>
            <h2 id="built-for-heading">
              Your program. <br />
              Your way forward.
            </h2>
          </div>
          <p>
            One team or an entire association. <br />
            Make a consistent experience your standard.
          </p>
        </div>
        <div className="landing-program-grid">
          {audiences.map((a) => (
            <Link prefetch={false} className="landing-program" href={a.href} key={a.name}>
              <div>
                <span>{a.number}</span>
                <ArrowRight size={24} aria-hidden="true" />
              </div>
              <h3>{a.name}</h3>
              <p>{a.text}</p>
              <strong>{a.detail}</strong>
            </Link>
          ))}
        </div>
      </section>

      <section className="landing-guides-wrap" aria-labelledby="landing-guides-title">
        <div className="landing-section landing-guides" data-reveal>
          <div>
            <span className="landing-guide-symbol">
              <BookOpen size={32} aria-hidden="true" />
            </span>
            <p className="landing-kicker">Meet your playbook</p>
            <h2 id="landing-guides-title">
              Nobody starts <br />
              on their own.
            </h2>
            <p>
              Step-by-step instructions. Real screenshots. A guide for every person who makes tryout
              day happen.
            </p>
            <Link prefetch={false} href="/how-to" className="landing-text-link">
              Open the how-to hub <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
          <div className="landing-guide-grid">
            {guides.map((g) => (
              <Link prefetch={false} key={g.audience} href={`/how-to?audience=${g.audience}`}>
                <span>
                  <strong>{g.label}</strong>
                  <small>{g.detail}</small>
                </span>
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section
        className="landing-section landing-faq"
        aria-labelledby="landing-faq-title"
        data-reveal
      >
        <div>
          <p className="landing-kicker">A few things to know</p>
          <h2 id="landing-faq-title">
            Before you <br />
            get started.
          </h2>
          <Link prefetch={false} href="/pricing" className="landing-text-link">
            View plans and pricing <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
        <div className="landing-faq-items">
          {[
            [
              'Can we use our own scoring criteria?',
              'Yes. Your organization defines the sport, sessions, rubric categories, scoring scales and weights. Evaluators score against the criteria you set for their assigned sessions.',
            ],
            [
              'Does TryoutFlow choose the team?',
              'Your coaches and directors make the decisions. TryoutFlow brings scores, evaluation coverage and athlete comparisons together to support the review, then records your confirmed roster.',
            ],
            [
              'Do parents need a staff account?',
              'No. Families use the public registration link for your event. A verified participant account can then be linked by the organizer to view approved information for the correct athlete.',
            ],
            [
              'Where can our staff learn the workflow?',
              'The how-to hub has separate visual guides for coaches, evaluators, check-in staff, reviewers, scouting and performance staff, and parents and athletes. Each guide follows the process from beginning to end.',
            ],
          ].map(([q, a]) => (
            <details key={q}>
              <summary>
                {q}
                <span aria-hidden="true">+</span>
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="landing-closing" aria-labelledby="landing-closing-title">
        <div className="landing-closing-lines" aria-hidden="true" />
        <div data-reveal>
          <p className="landing-kicker">
            <Sparkles size={16} aria-hidden="true" /> The next team is out there
          </p>
          <h2 id="landing-closing-title">
            Give potential <br />
            <em>a place to play.</em>
          </h2>
          <p>Build your next tryout around the people who make it matter.</p>
          <div className="landing-actions">
            <Link prefetch={false} href="/demo" className="landing-button landing-button-lime">
              Try the demo <ArrowRight size={19} aria-hidden="true" />
            </Link>
            <Link prefetch={false} href="/pricing" className="landing-button landing-button-dark">
              View Pro plans <ArrowRight size={19} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </LandingReveal>
  );
}
