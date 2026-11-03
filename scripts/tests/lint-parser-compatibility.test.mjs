import assert from 'node:assert/strict';
import test from 'node:test';
import { ESLint } from 'eslint';

const eslint = new ESLint();
for (const [extension, code] of [
  ['js', 'export const value = 1;'],
  ['mjs', 'export const value = await Promise.resolve(1);'],
  ['jsx', 'export const View = () => <main>Tryouts</main>;'],
  ['ts', 'export const identity = <T>(value: T): T => value;'],
  ['mts', 'export const value = { id: 1 } satisfies { id: number };'],
  ['cts', 'export type Identifier = string | number;'],
  [
    'tsx',
    'type Props = { title: string }; export const View = ({title}: Props) => <main>{title}</main>;',
  ],
]) {
  test(`real lint configuration parses ${extension}`, async () => {
    const [result] = await eslint.lintText(code, { filePath: `src/lint-contract.${extension}` });
    assert.deepEqual(result.messages, []);
  });
}

test('Next rules still report TypeScript JSX violations with useful locations', async () => {
  const [result] = await eslint.lintText(
    'export const View = (): unknown => <img src="/athlete.png" />;',
    { filePath: 'src/lint-contract.tsx' },
  );
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].ruleId, '@next/next/no-img-element');
  assert.equal(result.messages[0].line, 1);
  assert.equal(result.messages[0].column, 36);
});

test('parser scope manager resolves configured globals under ESLint 10', async () => {
  const scoped = new ESLint({
    overrideConfig: {
      languageOptions: { globals: { console: 'readonly' } },
      rules: { 'no-undef': 'error' },
    },
  });
  const [result] = await scoped.lintText('console.log(Math.PI, missingValue);', {
    filePath: 'src/lint-contract.js',
  });
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].ruleId, 'no-undef');
  assert.match(result.messages[0].message, /missingValue/);
});

test('malformed TypeScript is rejected instead of silently skipped', async () => {
  const [result] = await eslint.lintText('const value: = ;', { filePath: 'src/lint-contract.ts' });
  assert.equal(result.fatalErrorCount, 1);
});
