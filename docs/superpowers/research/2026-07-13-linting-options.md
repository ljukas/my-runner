# Linting options — research

Date: 2026-07-13
Status: **decided — implemented via ADR 0014** ([0014-eslint-prettier-linting-stack.md](../../adr/0014-eslint-prettier-linting-stack.md)). Evaluates linter choices for
my-runner; the recommendation shipped in the same PR as this doc.

## Current state (verified in-repo)

- `eslint.config.js` is the stock Expo template: `eslint-config-expo/flat` + a `dist/` ignore.
  Run via `bun run lint` → `expo lint` (ESLint 9, flat config, cached).
- `eslint-config-expo@57.0.0` bundles: `@typescript-eslint/{parser,eslint-plugin}` v8
  (a hand-picked *syntactic* rule set — no type-checked rules), `eslint-plugin-expo`,
  `eslint-plugin-import`, `eslint-plugin-react`, and `eslint-plugin-react-hooks@7.1.1`
  via `plugin:react-hooks/recommended`.
- **The react-hooks v7 `recommended` preset already includes the React Compiler-powered
  rules**: `purity`, `immutability`, `preserve-manual-memoization`, `static-components`,
  `set-state-in-effect`, `set-state-in-render`, `refs`, `globals`, `error-boundaries`,
  `use-memo`, `incompatible-library`, `gating`, `config` — on top of the classic
  `rules-of-hooks` / `exhaustive-deps`. Per Expo's React Compiler guide, SDK 55+ ships these
  by default through `eslint-config-expo`.
- No formatter (no Prettier/Biome config), no Tailwind/Uniwind class sorting, no lint step in
  CI yet (the future EAS `checks` job per ADR 0001 is the intended home).
- Scale: 43 `.ts`/`.tsx` files under `src/`. `bun run lint` completes in **<1s**.

## Facts that constrain the choice

1. **React Compiler is enabled** (`experiments.reactCompiler: true` in app.json). The compiler
   silently bails out of optimizing any component that violates the Rules of React; the *only*
   tooling that surfaces those violations is the compiler-backed rule set inside
   `eslint-plugin-react-hooks` v6+/v7 (the old `eslint-plugin-react-compiler`, merged
   upstream). Neither Biome nor oxlint can run these rules — they are powered by the actual
   compiler frontend (Babel-based), not re-implementable as syntax-level ports. Dropping
   ESLint means flying blind on compiler bailouts.
2. **`expo lint` is the first-party path.** Expo's docs, template, and SDK-versioned
   `eslint-config-expo` releases track ESLint; `eslint-plugin-expo` carries Expo-specific
   rules (env-var usage etc.) with no Biome/oxlint equivalent.
3. **Speed is a non-issue here.** The headline advantage of the Rust linters (oxlint ~50-100×,
   Biome ~15-25× on large repos) is irrelevant at 43 files / sub-second runs, and will remain
   marginal at any size this app plausibly reaches.
4. **Styling is Uniwind (Tailwind v4, CSS-first config in `src/global.css`)** — ADR 0002.
   Class sorting is the one genuinely missing lint/format capability. Tailwind's official
   `prettier-plugin-tailwindcss` supports v4 via `tailwindStylesheet` (point it at
   `src/global.css`) and sorts inside function calls via `tailwindFunctions` (`cva`, `cn` —
   matches ADR 0013 conventions). Uniwind's own docs prescribe nothing for linting.
5. **`bun run typecheck` (`tsc --noEmit`) already exists**, so type *errors* are covered;
   the open question is only type-aware *lint* rules (e.g. `no-floating-promises`).

## Option A — Keep ESLint (`expo lint`) and harden it ✅ recommended

Stay on `eslint-config-expo/flat`, add the missing pieces:

- **Formatting + class sorting:** Prettier + `prettier-plugin-tailwindcss`
  (`tailwindStylesheet: "./src/global.css"`, `tailwindFunctions: ["cva", "cn"]`).
  Two wiring variants:
  - *Expo-documented:* `eslint-plugin-prettier/recommended` appended to the flat config —
    formatting violations surface as lint errors, one command (`bun run lint --fix` fixes
    both). This is the variant Expo's using-eslint guide shows.
  - *Separate:* `prettier --check` as its own script + `eslint-config-prettier` to silence
    stylistic conflicts. Cleaner separation, two commands.
  At this repo's size the Expo-documented variant's usual downside (slow, noisy lint runs)
  doesn't bite; either is fine.
- **Type-aware rules (optional hardening):** scope typescript-eslint's
  `recommendedTypeChecked` (or at minimum `@typescript-eslint/no-floating-promises`) to
  `src/`. Directly relevant to the run engine's async event-log writes and expo-sqlite
  calls, where a dropped promise is a silent data-loss bug.
- **CI:** `bun run lint` joins `bun test` + `bun run typecheck` in the future EAS `checks`
  job (ADR 0001).

**Pros:** only option that keeps React Compiler diagnostics (constraint 1); first-party Expo
path, SDK-versioned config that upgrades with `upgrading-expo`; official Tailwind plugin for
class sorting; zero migration risk — additive changes to a working setup.
**Cons:** ESLint's plugin/config sprawl (mitigated: eslint-config-expo owns the plugin set);
slowest of the three (irrelevant at this scale); Prettier is a second tool rather than an
all-in-one.

## Option B — Biome 2.x (lint + format in one tool)

- Has a first-class `reactnative` linter domain, `useExhaustiveDependencies` +
  `useHookAtTopLevel` (ports of the two classic hooks rules), import organizing, and
  `useSortedClasses` (Tailwind-style class sorting, `cva`-aware) — plus its Prettier-parity
  formatter. Single config file, single fast binary.

**Pros:** one tool replaces ESLint+Prettier; good DX (`biome check --write`); RN domain shows
real ecosystem intent; class sorting built in.
**Cons (disqualifying here):** loses *all* React Compiler rules (constraint 1) and all
`eslint-plugin-expo` rules; abandons `expo lint` / the Expo-official path — fights the
framework on every SDK upgrade; `useSortedClasses` is still a nursery rule and not
theme-aware (doesn't read `global.css`); Biome's type-aware story (self-built inference) is
partial. The speed win it's priced on is worth ~0 at this repo's size.

## Option C — oxlint (standalone, or hybrid alongside ESLint)

- Fastest of all; 500+ built-in rule ports (react `rules-of-hooks`/`exhaustive-deps`, import,
  unicorn, jsx-a11y, typescript); type-aware linting now available via tsgolint
  (`--type-aware`); `eslint-plugin-oxlint` disables overlapping ESLint rules for a hybrid
  setup. Formatting would come from the newer `oxfmt` or still-separate Prettier.

**Pros:** raw speed; broadest rule count; credible type-aware path without tsc-based lint.
**Cons (disqualifying here):** standalone has the same React Compiler + `eslint-plugin-expo`
gaps as Biome; hybrid mode keeps ESLint anyway — two linters, two configs, double
suppression bookkeeping, to shave milliseconds off a sub-second run; no Expo integration;
running `eslint-plugin-react-compiler` through oxlint's JS-plugin bridge is reported slow,
which defeats the purpose.

## Comparison

| | A: ESLint hardened | B: Biome | C: oxlint |
|---|---|---|---|
| React Compiler rules (constraint 1) | ✅ full, already on | ❌ | ❌ (or via slow JS bridge) |
| Expo-specific rules / `expo lint` | ✅ | ❌ | ❌ |
| Hooks rules | ✅ v7 | ⚠️ 2 classic ports | ⚠️ 2 classic ports |
| Uniwind class sorting | ✅ official Tailwind plugin, v4 `global.css`-aware | ⚠️ nursery, not theme-aware | ❌ |
| Formatter | Prettier (add) | ✅ built in | oxfmt (separate, young) |
| Type-aware lint | ✅ typescript-eslint (opt-in) | ⚠️ partial | ✅ tsgolint |
| Speed on this repo | <1s | <1s | <1s |
| Survives `upgrading-expo` untouched | ✅ SDK-versioned | ❌ | ❌ |
| Official-tooling fit | Expo + Tailwind first-party | third-party | third-party |

## Recommendation

**Option A.** The stock config is already ~90% of a proper setup — including the React
Compiler rule set, which is the single most valuable lint surface in this repo and which no
alternative can provide. The actual gaps are formatting, Uniwind class sorting, and
(optionally) type-aware promise safety — all additive to the existing ESLint setup, none
solved better by switching. Biome/oxlint trade away compiler diagnostics and the Expo-official
path to win a speed contest this repo isn't running.

Proposed follow-up (separate implementation task): add Prettier +
`prettier-plugin-tailwindcss`, decide plugin-vs-separate wiring, consider
`no-floating-promises` scoped to `src/`, and fold `lint` into the EAS `checks` job when it
lands. Worth an ADR once implemented (styling ADR 0002 and release ADR 0012 set the pattern).

## Sources

- Expo using-eslint guide + React Compiler guide (Context7 `/expo/expo`, 2026-07):
  SDK 55+ ships compiler lint rules via `eslint-config-expo`; Prettier flat-config wiring.
- Installed packages (verified locally): `eslint-config-expo@57.0.0` dependency tree;
  `eslint-plugin-react-hooks@7.1.1` `recommended` preset rule dump.
- Biome docs (Context7 `/biomejs/website`): `reactnative` domain, `useSortedClasses`
  (nursery), rules-sources mapping for react-hooks ports.
- oxlint docs (Context7 `/websites/oxc_rs_guide_usage`): react plugin rules, `--type-aware`
  / tsgolint, `eslint-plugin-oxlint` hybrid migration guidance.
- `prettier-plugin-tailwindcss` README (Context7): `tailwindStylesheet` for v4,
  `tailwindFunctions`.
- Ecosystem comparisons (web, 2026): [PkgPulse — Biome vs ESLint vs Oxlint 2026](https://www.pkgpulse.com/guides/biome-vs-eslint-vs-oxlint-2026),
  [jsmanifest — Biome vs Oxlint 2026](https://jsmanifest.com/biome-oxlint-comparison-2026),
  [charpeni — Migrating from ESLint, Biome, and Prettier to Oxlint and Oxfmt](https://charpeni.com/blog/migrating-from-eslint-biome-prettier-to-oxlint-oxfmt).
