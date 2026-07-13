// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

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
    // uniwind-types.d.ts (Metro) and src/db/migrations (drizzle-kit) are
    // generated in their generators' own style — formatting them just fights
    // the generator on the next regeneration.
    ignores: ['dist/*', 'src/uniwind-types.d.ts', 'src/db/migrations/**'],
  },
]);
