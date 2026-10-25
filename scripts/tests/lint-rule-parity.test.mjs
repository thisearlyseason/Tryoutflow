import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { Linter } from 'eslint';
import { verifyLintCompatibility } from '../lib/verify-lint-compatibility.mjs';
const require = createRequire(import.meta.url);
const plugin = require('@tryoutflow/next-lint-compat');
const vectors = JSON.parse(
  readFileSync(new URL('./lint-rule-parity-vectors.json', import.meta.url), 'utf8'),
);

test('reviewed private source integrity', () =>
  verifyLintCompatibility(new URL('../..', import.meta.url).pathname));
for (const [index, vector] of vectors.entries())
  test(`${vector.rule}: frozen original diagnostic ${index}`, () => {
    const actual = new Linter({ cwd: '/' }).verify(
      vector.code,
      [
        {
          files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
          languageOptions: vector.languageOptions,
          plugins: { '@next/next': plugin },
          settings: vector.settings,
          rules: { [`@next/next/${vector.rule}`]: ['warn', ...vector.options] },
        },
      ],
      { filename: vector.filename },
    );
    assert.deepEqual(actual, vector.expectedDiagnostics);
  });

test('parser is supplied by the pinned patched runtime Next package', () => {
  const wrapper = require('@tryoutflow/next-lint-compat/parser.js');
  const compiled = require('next/dist/compiled/babel/eslint-parser');
  assert.equal(wrapper.parse, compiled.parse);
  assert.equal(wrapper.parseForESLint, compiled.parseForESLint);
  assert.equal(wrapper.meta.version, '16.4.1');
});
test('existing namespaced suppression remains effective', () => {
  const messages = new Linter().verify(
    '// eslint-disable-next-line @next/next/no-img-element\nconst image = <img src="/x.png"/>;',
    [
      {
        languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { '@next/next': plugin },
        rules: { '@next/next/no-img-element': 'warn' },
      },
    ],
  );
  assert.equal(messages.length, 0);
});
