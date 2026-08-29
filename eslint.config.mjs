import nextPlugin from '@next/eslint-plugin-next';
import nextParser from 'eslint-config-next/parser';

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
