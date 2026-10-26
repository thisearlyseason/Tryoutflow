// @vitest-environment node
import { createRequire } from 'node:module';
import { afterEach, expect, test, vi } from 'vitest';
const requireMobile = createRequire(new URL('../package.json', import.meta.url));
const { transformSync } = requireMobile('@babel/core');
const plugin = requireMobile('./public-environment.cjs');
afterEach(() => vi.unstubAllEnvs());

test('native builds inline only the five existing public settings', () => {
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://fictional.tryoutflow.test');
  vi.stubEnv('PRIVATE_TEST_SECRET', 'fictional-sensitive-value');
  const result = transformSync(
    'const url = process.env.EXPO_PUBLIC_API_URL; const other = process.env.PRIVATE_TEST_SECRET;',
    {
      configFile: false,
      babelrc: false,
      plugins: [plugin],
    },
  ).code;
  expect(result).toContain('https://fictional.tryoutflow.test');
  expect(result).not.toContain('fictional-sensitive-value');
  expect(result).toContain('process.env.PRIVATE_TEST_SECRET');
  expect(plugin.publicNames).toHaveLength(5);
});

test('a missing purchase key stays absent instead of acquiring a fallback credential', () => {
  vi.stubEnv('EXPO_PUBLIC_REVENUECAT_APPLE_KEY', undefined);
  const result = transformSync('const key = process.env.EXPO_PUBLIC_REVENUECAT_APPLE_KEY;', {
    configFile: false,
    babelrc: false,
    plugins: [plugin],
  }).code;
  expect(result).toContain('void 0');
});
