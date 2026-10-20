import nextPlugin from '@tryoutflow/next-lint-compat';
import nextParser from '@tryoutflow/next-lint-compat/parser.js';

export default [
  {
    ignores: ['.next/**', 'tests/fixtures/**/.next/**', 'coverage/**', 'playwright-report/**'],
  },
  {
    files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
    languageOptions: {
      parser: nextParser,
      parserOptions: {
        requireConfigFile: false,
        sourceType: 'module',
        allowImportExportEverywhere: true,
        babelOptions: {
          presets: ['next/babel'],
          caller: {
            supportsTopLevelAwait: true,
          },
        },
      },
    },
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: nextPlugin.configs['core-web-vitals'].rules,
  },
];
