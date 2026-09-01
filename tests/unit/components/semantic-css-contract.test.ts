import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const semanticClass = /^(?:app-|auth-|button-|field-|workspace-|game-day$|card$|eyebrow$)/u;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return extname(path) === '.tsx' ? [path] : [];
  });
}

function usedSemanticClasses(directory: string): string[] {
  const classes = new Set<string>();
  for (const file of sourceFiles(directory)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/className=(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/gu)) {
      const value = match[1] ?? match[2] ?? match[3] ?? '';
      for (const className of value.split(/\s+/u)) {
        if (semanticClass.test(className)) classes.add(className);
      }
    }
  }
  return [...classes].sort();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

describe('semantic CSS contract', () => {
  it('defines every reserved semantic class used by product components', () => {
    const used = usedSemanticClasses(resolve(process.cwd(), 'src'));
    const css = [
      readFileSync(resolve(process.cwd(), 'src/app/theme.css'), 'utf8'),
      readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8'),
    ].join('\n');

    expect(used).toEqual(
      expect.arrayContaining(['auth-card', 'auth-page', 'button-secondary', 'card', 'eyebrow']),
    );
    for (const className of used) {
      expect(css, `missing semantic CSS for .${className}`).toMatch(
        new RegExp(`\\.${escapeRegExp(className)}(?:[\\s:{,.#>]|$)`, 'u'),
      );
    }
  });
});
