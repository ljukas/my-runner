# 14. Linting: hardened ESLint via `expo lint`, Prettier as the formatter

Date: 2026-07-13

## Status

Accepted. Options considered (Biome, oxlint) are evaluated in
[`docs/superpowers/research/2026-07-13-linting-options.md`](../superpowers/research/2026-07-13-linting-options.md).

## Context

The repo shipped with the stock Expo template lint setup: `eslint-config-expo/flat`
plus a `dist/` ignore, run via `expo lint`. Missing pieces: a formatter, Uniwind
(Tailwind) class sorting, and type-aware promise safety. Rust-based all-in-one
alternatives (Biome 2.x, oxlint) were evaluated as replacements.

Two facts dominate the decision:

- **React Compiler is enabled** (`experiments.reactCompiler` in app.json). The
  compiler silently skips optimizing components that violate the Rules of React;
  the compiler-backed rules inside `eslint-plugin-react-hooks` v7 (`purity`,
  `immutability`, `preserve-manual-memoization`, `set-state-in-effect`, …) are the
  only tooling that surfaces those bailouts — they run the actual compiler frontend
  and have no Biome/oxlint equivalent. `eslint-config-expo` (SDK 55+) enables them
  by default.
- **Lint speed is a non-factor.** `expo lint` completes in under a second on this
  codebase; the Rust linters' headline advantage buys nothing here, while switching
  forfeits the compiler rules, `eslint-plugin-expo`, and the SDK-versioned config
  that upgrades in lockstep with Expo.

## Decision

Stay on ESLint through `expo lint`, hardened four ways:

1. **Prettier is the formatter, enforced through ESLint** via
   `eslint-plugin-prettier/recommended` (the Expo-documented flat-config wiring:
   plugin + `eslint-config-prettier` conflict-silencing). `bun run lint` reports
   formatting violations; `bun run lint --fix` fixes them. No separate format
   command or CI step is needed.
2. **Uniwind class sorting** via the official `prettier-plugin-tailwindcss`:
   `tailwindStylesheet` points at `src/global.css`, `tailwindFunctions` covers
   `cva`/`cn` (the ADR 0013 idioms).
3. **Type-aware promise safety**: `@typescript-eslint/no-floating-promises` at
   `error`, scoped to `src/**/*.{ts,tsx}` with `projectService: true`. A dropped
   promise around the run engine's event log or expo-sqlite writes is silent data
   loss; fire-and-forget calls must be marked with `void`.
4. **Unused-import removal** via `eslint-plugin-unused-imports`:
   `unused-imports/no-unused-imports` at `error` — the only rule in this stack that
   can actually delete an unused import, since `@typescript-eslint/no-unused-vars`
   reports without a fixer. Removal has to live in ESLint rather than in the
   editor: the on-save pass is `source.fixAll.eslint` alone, because adding
   TypeScript's `organizeImports` alongside it put two whole-file rewriters in one
   save pass, and TypeScript's offsets — computed before Prettier's rewrite —
   deleted real code. ESLint re-parses between its own fix passes, so its fixers
   cannot go stale. `unused-imports/no-unused-vars` (same options) replaces the
   `@typescript-eslint` rule so unused *values* stay a non-destructive warning and
   nothing is double-reported.

Generated files are exempt from linting — Metro regenerates
`src/uniwind-types.d.ts` and drizzle-kit regenerates `src/db/migrations/` in
their own styles, so formatting them fights the generators.

## Consequences

- The lint gate is `bun run lint` (joins `bun test` / `bun run typecheck`; all
  three belong in the future EAS `checks` job — ADR 0001).
- Unused imports fail `bun run lint` and are deleted by `--fix` and by an editor
  save; unused locals and params stay warnings, which `expo lint` does not fail on
  (it passes `--max-warnings` only when given one).
- Known limitation: class sorting is not theme-aware. Uniwind declares theme
  tokens via `@layer theme`/`@variant` rather than Tailwind v4 `@theme` blocks,
  so utilities like `bg-primary` are unknown to the sorter and are grouped
  deterministically at the front of the class list instead of in canonical
  position. Stable and idempotent, just not canonical for custom utilities.
- Type-aware linting only covers `src/`; config files at the repo root stay
  syntactic-only, avoiding tsconfig project-service noise for non-app files.
- Revisit if either fact in Context flips: React Compiler rules become available
  outside ESLint, or lint time grows enough to matter.
