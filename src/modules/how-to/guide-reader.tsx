'use client';
import { PrintReport } from '@/modules/talent/ui/report-actions';

import { FeedbackButton } from '@/components/ui/button';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Expand,
  Printer,
  Search,
  X,
} from 'lucide-react';
import {
  guideAudiences,
  isGuideAudience,
  guideLabels,
  guides,
  type GuideAudience,
  type GuideStep,
} from './guide-content';
import screenshots from './screenshots.json';

type Screenshot = { width: number; height: number };
const imageInfo: Record<string, Screenshot> = screenshots;

export function GuideAudienceReader() {
  const searchParams = useSearchParams();
  const requested = searchParams.get('audience');
  const audience = isGuideAudience(requested) ? requested : 'coaches';
  return <GuideReader key={audience} audience={audience} />;
}

function StepScreenshot({ step, number }: { step: GuideStep; number: number }) {
  const info = imageInfo[step.image];
  if (!info) throw new Error(`Missing guide screenshot: ${step.image}`);
  return (
    <Dialog.Root>
      <figure className="howto-shot">
        <Dialog.Trigger asChild>
          <FeedbackButton
            type="button"
            className="howto-shot-button"
            aria-label={`Enlarge screenshot for step ${number}: ${step.title}`}
          >
            <Image
              src={`/how-to/${step.image}.webp`}
              alt={`${step.title}: the actual TryoutFlow screen using fictional demonstration data.`}
              width={info.width}
              height={info.height}
              sizes="(max-width: 850px) 90vw, 520px"
              unoptimized
            />
            <span className="howto-enlarge">
              <Expand size={15} aria-hidden="true" /> View full screenshot
            </span>
          </FeedbackButton>
        </Dialog.Trigger>
        <figcaption>
          Step {number} · {step.where}
        </figcaption>
      </figure>
      <Dialog.Portal>
        <Dialog.Overlay className="howto-dialog-overlay" />
        <Dialog.Content className="howto-dialog">
          <header className="howto-dialog-header">
            <div>
              <Dialog.Title>
                Step {number}: {step.title}
              </Dialog.Title>
              <Dialog.Description>{step.where}. Fictional demonstration data.</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <FeedbackButton
                type="button"
                className="howto-icon-button"
                aria-label="Close screenshot"
              >
                <X size={22} />
              </FeedbackButton>
            </Dialog.Close>
          </header>
          <div className="howto-dialog-image">
            <Image
              src={`/how-to/${step.image}.webp`}
              alt={`Full screenshot: ${step.title}`}
              width={info.width}
              height={info.height}
              sizes="95vw"
              unoptimized
            />
          </div>
          <a
            className="howto-original"
            href={`/how-to/${step.image}.webp`}
            target="_blank"
            rel="noreferrer"
          >
            Open original image in a new tab <ArrowRight size={15} aria-hidden="true" />
          </a>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function GuideReader({ audience }: { audience: GuideAudience }) {
  const [query, setQuery] = useState('');
  const chapters = guides[audience];
  const total = chapters.reduce((count, chapter) => count + chapter.steps.length, 0);
  const label = guideLabels[audience];
  const numbered = useMemo(() => {
    let number = 0;
    return chapters.map((chapter) => ({
      ...chapter,
      steps: chapter.steps.map((step) => ({ ...step, number: ++number })),
    }));
  }, [chapters]);
  const normalized = query.trim().toLocaleLowerCase();
  const visible = numbered
    .map((chapter) => ({
      ...chapter,
      steps: chapter.steps.filter(
        (step) =>
          !normalized ||
          [chapter.title, step.title, step.where, ...step.actions, step.result, step.note ?? '']
            .join(' ')
            .toLocaleLowerCase()
            .includes(normalized),
      ),
    }))
    .filter((chapter) => chapter.steps.length);
  const matches = visible.reduce((count, chapter) => count + chapter.steps.length, 0);

  return (
    <div className="howto">
      <section className="howto-hero" aria-labelledby="howto-title">
        <div className="howto-hero-inner">
          <p className="howto-eyebrow">
            <BookOpen size={17} aria-hidden="true" /> THE TRYOUTFLOW PLAYBOOK
          </p>
          <h1 id="howto-title">
            Every step.
            <br />
            <span>A little more confidence.</span>
          </h1>
          <p className="howto-intro">
            Your complete, visual guide to TryoutFlow. Choose your role or workflow and follow the
            journey from your first sign-in to your final handoff.
          </p>
          <nav className="howto-audiences" aria-label="Choose your how-to guide">
            {guideAudiences.map((role) => (
              <Link
                key={role}
                href={`/how-to?audience=${role}`}
                aria-current={audience === role ? 'page' : undefined}
                className={audience === role ? 'is-selected' : ''}
              >
                <span>{guideLabels[role].title}</span>
                <small>{guideLabels[role].summary}</small>
                <ArrowRight size={20} aria-hidden="true" />
              </Link>
            ))}
          </nav>
        </div>
      </section>
      <div className="howto-shell">
        <div className="howto-introduction">
          <div>
            <p className="howto-eyebrow">
              {total} STEPS · {chapters.length} CHAPTERS
            </p>
            <h2>{label.title}</h2>
            <p>{label.description}</p>
          </div>
          <PrintReport label="Print guide" className="howto-print" />
        </div>
        <p className="howto-demo-note">
          <strong>Real screens. Example people.</strong> Screenshots use a fictional local club.
          Your names, dates, questions and available tools will depend on the event and your role.
          Select any screenshot to read it at full size.
        </p>
        <nav className="howto-demo-note" aria-label="Plan-specific guides">
          <strong>Plan-specific help: </strong>
          <Link
            className="font-bold underline"
            onClick={() => setQuery('')}
            href="/how-to?audience=coaches#coach-team-workspaces"
          >
            Organization team workspaces
          </Link>
          {' · '}
          <Link
            className="font-bold underline"
            onClick={() => setQuery('')}
            href="/how-to?audience=coaches#coach-single-tryout"
          >
            Single Tryout completion &amp; locking
          </Link>
        </nav>
        <div className="howto-layout">
          <aside className="howto-sidebar">
            <label className="howto-search">
              <span>Find a step</span>
              <span className="howto-search-input">
                <Search size={17} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Try “invitation” or “save”"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </span>
            </label>
            <p className="howto-search-status" aria-live="polite">
              {normalized
                ? `${matches} of ${total} steps match`
                : 'Start at the beginning or jump to a chapter.'}
            </p>
            {normalized && (
              <FeedbackButton className="howto-clear" type="button" onClick={() => setQuery('')}>
                Clear search
              </FeedbackButton>
            )}
            <nav aria-label="Guide chapters">
              {visible.map((chapter) => (
                <a href={`#${chapter.id}`} key={chapter.id}>
                  <span>
                    {String(numbered.findIndex((item) => item.id === chapter.id) + 1).padStart(
                      2,
                      '0',
                    )}
                  </span>
                  {chapter.title}
                  <ChevronRight size={15} aria-hidden="true" />
                </a>
              ))}
            </nav>
            <div className="howto-help">
              <strong>Before you begin</strong>
              <p>{label.preparation}</p>
              <Link href={label.start}>
                {label.startLabel} <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </aside>
          <div className="howto-chapters">
            {!visible.length && (
              <section className="howto-empty">
                <h3>No matching steps</h3>
                <p>Try another word, such as registration, scores, fees or account.</p>
                <FeedbackButton type="button" onClick={() => setQuery('')}>
                  Show the complete guide
                </FeedbackButton>
              </section>
            )}
            {visible.map((chapter) => (
              <section
                className="howto-chapter"
                id={chapter.id}
                key={chapter.id}
                aria-labelledby={`${chapter.id}-title`}
              >
                <header className="howto-chapter-header">
                  <p className="howto-eyebrow">
                    CHAPTER{' '}
                    {String(numbered.findIndex((item) => item.id === chapter.id) + 1).padStart(
                      2,
                      '0',
                    )}
                  </p>
                  <h3 id={`${chapter.id}-title`}>{chapter.title}</h3>
                  <p>{chapter.description}</p>
                </header>
                {chapter.steps.map((step) => (
                  <article
                    className="howto-step"
                    id={step.id}
                    key={step.id}
                    aria-labelledby={`${step.id}-title`}
                  >
                    <header className="howto-step-heading">
                      <a
                        className="howto-step-number"
                        href={`#${step.id}`}
                        aria-label={`Link to step ${step.number}`}
                      >
                        {String(step.number).padStart(2, '0')}
                      </a>
                      <div>
                        <p className="howto-where">{step.where}</p>
                        <h4 id={`${step.id}-title`}>{step.title}</h4>
                      </div>
                    </header>
                    <div className="howto-step-body">
                      <div className="howto-instructions">
                        <ol>
                          {step.actions.map((action) => (
                            <li key={action}>{action}</li>
                          ))}
                        </ol>
                        <p className="howto-result">
                          <Check size={18} aria-hidden="true" />
                          <span>
                            <strong>What happens next</strong>
                            {step.result}
                          </span>
                        </p>
                        {step.note && <p className="howto-note">{step.note}</p>}
                      </div>
                      <StepScreenshot step={step} number={step.number} />
                    </div>
                    <a className="howto-back" href="#howto-title">
                      Back to guide navigation ↑
                    </a>
                  </article>
                ))}
              </section>
            ))}
            <section className="howto-closing">
              <BookOpen size={28} aria-hidden="true" />
              <h3>Keep the next step clear.</h3>
              <p>{label.closing}</p>
              <Link href={`/how-to?audience=${audience === 'coaches' ? 'parents' : 'coaches'}`}>
                {audience === 'coaches'
                  ? 'Open the parent & athlete guide'
                  : 'Open the coach & organizer guide'}{' '}
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
