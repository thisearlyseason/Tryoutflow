import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const semanticClass = /^(?:app-|auth-|button-|field-|workspace-|game-day$|card$|eyebrow$)/u;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return extname(path) === '.tsx' ? [path] : [];
  });
}

type AstNode = { type: string; [key: string]: unknown };
const { parseForESLint } = createRequire(import.meta.url)(
  'next/dist/compiled/babel/eslint-parser',
) as {
  parseForESLint(source: string, options: Record<string, unknown>): { ast: AstNode };
};
const isNode = (value: unknown): value is AstNode =>
  typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
function children(node: AstNode): AstNode[] {
  return Object.entries(node).flatMap(([key, value]) => {
    if (['parent', 'tokens', 'comments', 'loc', 'range'].includes(key)) return [];
    return Array.isArray(value) ? value.filter(isNode) : isNode(value) ? [value] : [];
  });
}

function semanticClassesInSource(source: string): string[] {
  const classes = new Set<string>();
  const add = (value: string) => {
    for (const className of value.split(/\s+/u)) {
      if (semanticClass.test(className)) classes.add(className);
    }
  };
  const visitClassExpression = (node: AstNode) => {
    if (node.type === 'Literal' && typeof node.value === 'string') add(node.value);
    else if (node.type === 'TemplateLiteral' && Array.isArray(node.quasis)) {
      const quasis = node.quasis.filter(isNode);
      for (const [index, part] of quasis.entries()) {
        const literal = part.value as { cooked?: string; raw?: string };
        let value = literal.cooked ?? literal.raw ?? '';
        // Discard fragments joined directly to dynamic expressions, not complete classes.
        if (index > 0) value = value.replace(/^[^\s]*/u, '');
        if (index < quasis.length - 1) value = value.replace(/[^\s]*$/u, '');
        add(value);
      }
    } else if (node.type === 'ConditionalExpression') {
      if (isNode(node.consequent)) visitClassExpression(node.consequent);
      if (isNode(node.alternate)) visitClassExpression(node.alternate);
    } else for (const child of children(node)) visitClassExpression(child);
  };
  const visit = (node: AstNode) => {
    if (
      node.type === 'JSXAttribute' &&
      isNode(node.name) &&
      node.name.name === 'className' &&
      isNode(node.value)
    ) {
      if (node.value.type === 'Literal') visitClassExpression(node.value);
      else if (node.value.type === 'JSXExpressionContainer' && isNode(node.value.expression))
        visitClassExpression(node.value.expression);
    }
    for (const child of children(node)) visit(child);
  };
  visit(
    parseForESLint(source, {
      filePath: 'fixture.tsx',
      requireConfigFile: false,
      sourceType: 'module',
      babelOptions: { presets: ['next/babel'], caller: { supportsTopLevelAwait: true } },
    }).ast,
  );
  return [...classes].sort();
}

function usedSemanticClasses(directory: string): string[] {
  return [
    ...new Set(
      sourceFiles(directory).flatMap((file) => semanticClassesInSource(readFileSync(file, 'utf8'))),
    ),
  ].sort();
}

function rootLayoutStyles(): string {
  const sourceRoot = resolve(process.cwd(), 'src');
  const styles = new Map<string, string>();
  const add = (path: string) => {
    expect(path.startsWith(`${sourceRoot}/`), 'local stylesheet must stay within src').toBe(true);
    if (styles.has(path)) return;
    const css = readFileSync(path, 'utf8');
    styles.set(path, css);
    for (const match of css.matchAll(/@import\s+['"]([^'"]+)['"]/gu)) {
      const imported = match[1]!;
      if (imported.startsWith('.')) add(resolve(dirname(path), imported));
    }
  };
  const layout = readFileSync(resolve(sourceRoot, 'app/layout.tsx'), 'utf8');
  for (const match of layout.matchAll(/^import\s+['"]([^'"]+\.css)['"]/gmu)) {
    const imported = match[1]!;
    add(
      imported.startsWith('@/')
        ? resolve(sourceRoot, imported.slice(2))
        : resolve(sourceRoot, 'app', imported),
    );
  }
  expect(styles.size).toBeGreaterThan(0);
  return [...styles.values()].join('\n');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

describe('semantic CSS contract', () => {
  it('collects reserved classes from JSX literals, branches and complete template tokens', () => {
    expect(
      semanticClassesInSource(`
      const unrelated = 'workspace-unrelated';
      const view = <>
        <main className={photo ? 'auth-page auth-page-photo' : 'auth-page'} />
        <div className="auth-card card" />
        <button className={active ? 'button-primary' : 'button-secondary'} />
        <div className={\`app-frame \${tone} field-valid\`} />
      </>;
    `),
    ).toEqual([
      'app-frame',
      'auth-card',
      'auth-page',
      'auth-page-photo',
      'button-primary',
      'button-secondary',
      'card',
      'field-valid',
    ]);
  });

  it('keeps a missing reserved selector detectable and ignores unrelated strings', () => {
    const used = semanticClassesInSource(
      `const text = 'auth-unrelated'; const node = <div className={'workspace-missing'} />;`,
    );
    expect(used).toEqual(['workspace-missing']);
    expect('.workspace-present {}').not.toMatch(
      new RegExp(`\\.${escapeRegExp(used[0]!)}(?:[\\s:{,.#>]|$)`, 'u'),
    );
  });

  it('defines every reserved semantic class used by product components', () => {
    const used = usedSemanticClasses(resolve(process.cwd(), 'src'));
    const css = rootLayoutStyles();

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
