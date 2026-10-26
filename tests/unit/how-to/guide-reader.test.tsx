import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GuideAudienceReader } from '../../../src/modules/how-to/guide-reader';
import { guides, guideAudiences, guideLabels } from '../../../src/modules/how-to/guide-content';
import screenshots from '../../../src/modules/how-to/screenshots.json';

const route = vi.hoisted(() => ({ audience: 'evaluators' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams({ audience: route.audience }),
}));

describe('role-specific how-to guides', () => {
  it.each(guideAudiences)('opens every supported guide directly: %s', (audience) => {
    route.audience = audience;
    render(<GuideAudienceReader />);
    expect(
      screen.getByRole('heading', { name: guideLabels[audience].title, level: 2 }),
    ).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(
      guides[audience].reduce((n, c) => n + c.steps.length, 0),
    );
    expect(
      screen
        .getByRole('navigation', { name: 'Choose your how-to guide' })
        .querySelector('[aria-current="page"]'),
    ).toHaveAttribute('href', `/how-to?audience=${audience}`);
  });
  it.each(['unknown', 'constructor', '__proto__'])(
    'falls back safely for unsupported audience %s',
    (audience) => {
      route.audience = audience;
      render(<GuideAudienceReader />);
      expect(screen.getAllByRole('article')).toHaveLength(
        guides.coaches.reduce((total, chapter) => total + chapter.steps.length, 0),
      );
    },
  );

  it('opens the evaluator deep link, exposes all role choices and clears filtering on a role change', () => {
    route.audience = 'evaluators';
    const { rerender } = render(<GuideAudienceReader />);
    const roles = screen.getByRole('navigation', { name: 'Choose your how-to guide' });
    expect(within(roles).getAllByRole('link')).toHaveLength(6);
    expect(within(roles).getByRole('link', { name: /^Evaluators/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('heading', { name: 'Accept your invitation & sign in' })).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(20);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a step' }), {
      target: { value: 'synchronization' },
    });
    expect(screen.getAllByRole('article').length).toBeLessThan(20);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a step' }), {
      target: { value: 'zz-no-guide-match-zz' },
    });
    expect(screen.getByRole('heading', { name: 'No matching steps' })).toBeVisible();
    route.audience = 'parents';
    rerender(<GuideAudienceReader />);
    expect(screen.getByRole('searchbox', { name: 'Find a step' })).toHaveValue('');
    expect(screen.getAllByRole('article')).toHaveLength(17);
  });

  it('keeps every published step anchor unique and backed by an actual WebP asset', () => {
    const ids: string[] = [];
    for (const chapters of Object.values(guides))
      for (const chapter of chapters) {
        ids.push(chapter.id);
        for (const step of chapter.steps) {
          ids.push(step.id);
          const asset = resolve('public/how-to', `${step.image}.webp`);
          expect(existsSync(asset), step.image).toBe(true);
          const bytes = readFileSync(asset);
          expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
          expect(screenshots).toHaveProperty(step.image);
        }
      }
    expect(new Set(ids).size).toBe(ids.length);
  });
});
