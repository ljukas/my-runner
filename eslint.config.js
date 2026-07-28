// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');
const unusedImports = require('eslint-plugin-unused-imports');

module.exports = defineConfig([
  expoConfig,
  eslintPluginPrettierRecommended,
  {
    // Type-aware rules: a dropped promise around the run engine's event log or
    // expo-sqlite writes is silent data loss, not a style issue.
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    // Deleting unused imports has to be an ESLint fixer — ESLint re-parses
    // between fix passes, while a second on-save rewriter (TypeScript's
    // organizeImports) applied offsets computed before Prettier's rewrite and
    // ate code. .vscode/settings.json therefore runs `source.fixAll.eslint` alone.
    plugins: { 'unused-imports': unusedImports },
    rules: {
      // Superseded by the fork below; leaving both on double-reports every hit.
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        { vars: 'all', args: 'none', ignoreRestSiblings: true, caughtErrors: 'all' },
      ],
    },
  },
  {
    // uniwind-types.d.ts (Metro) and src/db/migrations (drizzle-kit) are
    // generated in their generators' own style — formatting them just fights
    // the generator on the next regeneration.
    ignores: ['dist/*', 'src/uniwind-types.d.ts', 'src/db/migrations/**'],
  },
]);
