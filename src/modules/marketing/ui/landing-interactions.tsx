'use client';

import { FeedbackButton } from '@/components/ui/button';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowDown, ArrowRight, Check, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import screenshots from '../../how-to/screenshots.json';

/** Keep server-rendered content visible; motion enhances it after hydration. */
export function LandingReveal({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root.current || !('IntersectionObserver' in window)) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const elements = root.current.querySelectorAll<HTMLElement>('[data-reveal]');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (!preference.matches) entry.target.classList.add('landing-enter');
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.08 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  return (
    <div className="landing" ref={root}>
      {children}
    </div>
  );
}

const stages = [
  {
    id: 'prepare',
    label: 'Prepare',
    eyebrow: 'Before the first whistle',
    title: 'A great tryout starts with a clear plan.',
    description:
      'Build your event, schedule sessions, set your scoring criteria, and give families one place to register.',
    points: [
      'Custom registration questions and waivers',
      'Divisions, sessions and evaluator assignments',
      'A public registration link for your event',
    ],
    image: 'coach-review',
    alt: 'Tryout setup review showing divisions, sessions and readiness checks.',
    guide: 'coaches#coach-setup',
  },
  {
    id: 'checkin',
    label: 'Check in',
    eyebrow: 'Make a good first impression',
    title: 'Less time in line. More time in the game.',
    description:
      'Find registrations, confirm arrivals, and assign athlete numbers so everyone starts in the right place.',
    points: [
      'Search existing registrations',
      'Session placement and tryout numbers',
      'Clear confirmation and duplicate-number checks',
    ],
    image: 'checkin-confirmed',
    alt: 'Check-in screen showing a confirmed arrival and assigned athlete number.',
    guide: 'checkin',
  },
  {
    id: 'evaluate',
    label: 'Evaluate',
    eyebrow: 'Focus on the athlete',
    title: 'Turn observations into useful evidence.',
    description:
      'Give evaluators clear criteria, individual scorecards, and visible save states as they work through assigned athletes.',
    points: [
      'Sport-specific rubrics defined by your team',
      'Scores, observations and completion tracking',
      'Device drafts and server sync status',
    ],
    image: 'evaluator-completed',
    alt: 'Evaluator scorecard showing an evaluation marked complete.',
    guide: 'evaluators',
  },
  {
    id: 'decide',
    label: 'Decide',
    eyebrow: 'The whole picture',
    title: 'Make the call with context.',
    description:
      'Review rankings alongside evaluation coverage, compare athletes, and confirm your roster before communicating decisions.',
    points: [
      'Side-by-side athlete comparisons',
      'Visible ties and missing evaluations',
      'Finalized rosters and reviewed message batches',
    ],
    image: 'reviewer-rankings',
    alt: 'Rankings with scores and evaluation coverage for a fictional event.',
    guide: 'reviewers',
  },
] as const;

export function WorkflowExplorer() {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const stage = stages[selected] ?? stages[0];
  const dimensions = screenshots[stage.image];
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % stages.length;
    else if (event.key === 'ArrowLeft') next = (index + stages.length - 1) % stages.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = stages.length - 1;
    else return;
    event.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  }
  return (
    <section
      className="landing-workflow landing-section"
      id="workflow"
      aria-label="Tryout day workflow"
      data-reveal
    >
      <div className="landing-section-heading">
        <div>
          <p className="landing-kicker">One connected workflow</p>
          <h2>
            From first sign-up. <br />
            To final lineup.
          </h2>
        </div>
        <p>
          Every stage has a place. <br />
          Explore how your next tryout comes together.
        </p>
      </div>
      <div role="tablist" aria-label="Explore the tryout workflow" className="landing-stage-tabs">
        {stages.map((item, index) => (
          <FeedbackButton
            key={item.id}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            role="tab"
            id={`stage-tab-${item.id}`}
            aria-controls="stage-panel"
            aria-selected={selected === index}
            tabIndex={selected === index ? 0 : -1}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => navigate(event, index)}
          >
            <span>0{index + 1}</span> {item.label}
            <ChevronRight size={18} aria-hidden="true" />
          </FeedbackButton>
        ))}
      </div>
      <div
        id="stage-panel"
        role="tabpanel"
        aria-labelledby={`stage-tab-${stage.id}`}
        tabIndex={0}
        className="landing-stage-panel"
      >
        <div className="landing-stage-copy" key={`${stage.id}-copy`}>
          <p className="landing-kicker">{stage.eyebrow}</p>
          <h3>{stage.title}</h3>
          <p>{stage.description}</p>
          <ul>
            {stage.points.map((point) => (
              <li key={point}>
                <Check size={17} aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
          <Link
            prefetch={false}
            className="landing-text-link"
            href={`/how-to?audience=${stage.guide}`}
          >
            See every step <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
        <figure className="landing-screen" key={stage.id}>
          <div className="landing-screen-bar">
            <span aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>TryoutFlow / {stage.label}</span>
            <span>Product preview</span>
          </div>
          <a
            href={`/how-to/${stage.image}.webp`}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open full ${stage.label.toLowerCase()} screenshot in a new tab`}
          >
            <Image
              src={`/how-to/${stage.image}.webp`}
              alt={stage.alt}
              width={dimensions.width}
              height={dimensions.height}
              sizes="(min-width: 900px) 58vw, 100vw"
            />
          </a>
          <figcaption>
            Real product. Fictional club and athletes.{' '}
            <span>
              Open image to explore <ArrowDown size={12} aria-hidden="true" />
            </span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

export function ScoringPreview() {
  const [score, setScore] = useState(4);
  const labels = ['Developing', 'Building', 'Consistent', 'Strong', 'Standout'];
  return (
    <div className="landing-score-demo">
      <div className="landing-score-top">
        <span>TRY A SAMPLE SCORECARD</span>
        <span>Interactive preview</span>
      </div>
      <div className="landing-score-athlete">
        <span className="landing-bib">18</span>
        <div>
          <strong>One athlete. Your observation.</strong>
          <p>Example criterion · Game sense</p>
        </div>
      </div>
      <fieldset>
        <legend>Choose a score</legend>
        <div className="landing-score-options">
          {[1, 2, 3, 4, 5].map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="sample-score"
                value={value}
                checked={score === value}
                onChange={() => setScore(value)}
              />
              <span>{value}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="landing-score-result" aria-live="polite">
        <strong>
          {score}/5 <span>{labels[score - 1]}</span>
        </strong>
        <span>Sample only · nothing is saved</span>
      </div>
      <div className="landing-score-meter" aria-hidden="true">
        <span style={{ width: `${score * 20}%` }} />
      </div>
    </div>
  );
}
