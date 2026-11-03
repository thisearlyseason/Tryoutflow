import nextPlugin from '@tryoutflow/next-lint-compat';
import babelParser from '@babel/eslint-parser';

// Use the maintained ESLint 10 parser, independent of Next's bundled Babel version.
const parserOptions = (plugins) => ({
  requireConfigFile: false,
  babelOptions: {
    babelrc: false,
    configFile: false,
    parserOpts: { allowImportExportEverywhere: true, plugins },
  },
});

export default [
  {
    ignores: [
      '.next/**',
      'tests/fixtures/**/.next/**',
      'coverage/**',
      'playwright-report/**',
      'apps/mobile/ios/Pods/**',
      'apps/mobile/ios/build/**',
      'apps/mobile/android/.gradle/**',
      'apps/mobile/android/build/**',
      'apps/mobile/android/app/build/**',
    ],
  },
  {
    files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
    languageOptions: {
      parser: babelParser,
      parserOptions: parserOptions(['jsx']),
    },
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: nextPlugin.configs['core-web-vitals'].rules,
  },
  {
    files: ['**/*.{ts,mts,cts}'],
    languageOptions: { parserOptions: parserOptions(['typescript']) },
  },
  {
    files: ['**/*.tsx'],
    languageOptions: { parserOptions: parserOptions(['typescript', 'jsx']) },
  },
];
