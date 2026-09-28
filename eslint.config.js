// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');
const unusedImports = require('eslint-plugin-unused-imports');
const { allExtensions } = require('eslint-config-expo/flat/utils/extensions');

module.exports = defineConfig([
  expoConfig,
  eslintPluginPrettierRecommended,
  {
    // The `@/` alias resolves through the TypeScript resolver, which knows tsconfig paths but not
    // Metro's platform suffixes — give it the same `.ios`/`.android` extension list Expo gives the
    // node resolver, or every `@/components/run-lock` import reads as unresolved.
    settings: {
      'import/resolver': {
        typescript: { extensions: allExtensions },
      },
    },
  },
  {
    // Type-aware rules: a dropped promise around the run engine's event log or
    // expo-sqlite writes is silent data loss, not a style issue.
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        // Both projects, because each excludes the other platform's forks (ADR 0003 item 3 as
        // amended by ADR 0025): every file under src/ is in exactly one of them.
        project: ['./tsconfig.json', './tsconfig.android.json'],
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
    // A SwiftUI import in an Android fork (or vice versa) is a native-module-not-found crash at
    // runtime, not a type error — the two vocabularies only exist on their own platform (ADR 0025).
    files: ['**/*.android.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['@expo/ui/swift-ui', '@expo/ui/swift-ui/*'] }],
    },
  },
  {
    files: ['**/*.ios.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['@expo/ui/jetpack-compose', '@expo/ui/jetpack-compose/*'] },
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
