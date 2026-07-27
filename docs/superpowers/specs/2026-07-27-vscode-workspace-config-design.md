# VS Code workspace configuration — design

Date: 2026-07-27
Status: Approved design, implemented

## Problem

`.vscode/settings.json` carried three unqualified `editor.codeActionsOnSave`
kinds (`source.fixAll`, `source.organizeImports`, `source.sortMembers`). VS Code
matches code-action kinds as **hierarchical prefixes**, so those fanned out to
every registered provider — `source.fixAll.eslint`, `source.fixAll.biome`,
`source.fixAll.ts`, and TypeScript's organize-imports.

Two independent whole-document rewriters therefore ran in a single save pass.
`eslint-plugin-prettier` (ADR 0014 runs Prettier as a lint rule) rewrote the
buffer and shifted byte offsets; TypeScript's organize-imports then applied
import-removal spans computed against the pre-rewrite buffer. The stale absolute
offsets overshot into real code and deleted it — reproduced against tsserver's
`organizeImports` API, where `export` was truncated to `rt`. It only fired when
formatting was actually wrong, because a Prettier-clean file produces no offset
shift, which is why it read as intermittent.

Beyond that, the workspace config did not describe the project: Tailwind
IntelliSense was inert, the 1.2 GB generated `ios/` tree was searched and
watched, and `extensions.json` recommended a single extension.

## Goal

A committed workspace configuration that is correct for this repo, cheap to run,
and self-explanatory to a contributor cloning it — with formatter authority
resting in the repo, never in a personal global profile.

## Non-goals

- Personal editor preferences (theme, font, vim, inlay hints) — those stay in
  the user profile.
- Replacing ADR 0014. Prettier-via-ESLint remains the formatting authority; this
  only decides how the editor invokes it.

## Decisions

### Save pipeline

- `editor.codeActionsOnSave` lists exactly one **fully qualified** kind,
  `source.fixAll.eslint`. Unqualified kinds are the defect and must not return.
- Formatting moves to `editor.formatOnSave` with Prettier pinned as
  `editor.defaultFormatter`, plus per-language overrides for `typescript`,
  `typescriptreact`, `javascript`, `json`, and `jsonc`. Format-on-save runs
  _after_ code actions settle and applies a full-range replace, so it is
  structurally incapable of going stale.
- `biome.enabled: false`. The extension ships `requireConfiguration: false`, so
  without this it activates against a repo that has no `biome.json` and no
  `@biomejs/biome` dependency, formatting `.ts` with its own defaults (double
  quotes, printWidth 80) against `.prettierrc` (single quotes, printWidth 100).

Per-language overrides are required rather than decorative: a language-specific
setting in the _user_ profile outranks a non-language-specific _workspace_
setting, so a bare workspace `editor.defaultFormatter` would lose to a personal
`[typescriptreact]` entry.

### TypeScript

`typescript.tsdk: "node_modules/typescript/lib"`. The repo pins `~6.0.3`, ahead
of the bundled tsserver. VS Code will not auto-load a workspace SDK, so this
surfaces a one-time trust prompt — acceptable, and the standard mechanism.

### Tailwind IntelliSense

Uniwind (ADR 0002) exposes ~28 discrete className props rather than one `class`
attribute, and Tailwind IntelliSense only completes inside attributes it knows.
`tailwindCSS.classAttributes` therefore carries the list published at
<https://docs.uniwind.dev/quickstart>.

`tailwindCSS.classFunctions` is `["cva", "cn", "useResolveClassNames"]` — the
first two mirror `tailwindFunctions` in `.prettierrc` so completion and
class-sorting agree on the same call sites. `useResolveClassNames` has no call
site in `src/` yet; it is Uniwind's documented default and the pattern AGENTS.md
prescribes for APIs needing a style object, so it is pre-registered.

`tailwindCSS.experimental.configFile` is deliberately **unset**: `src/global.css`
is the only stylesheet and opens with `@import 'tailwindcss'`, so v4
auto-detection is unambiguous.

### File associations

`files.associations` outranks an extension's own `filenamePatterns`. A blanket
`"*.yml": "github-actions-workflow"` in a user profile therefore validates
`.eas/workflows/deploy-production.yml` against the GitHub Actions schema. The
workspace narrows it with `"**/.eas/workflows/*.yml": "yaml"`, which is correct
whether VS Code merges or replaces the object across scopes: on merge the more
specific glob wins, and on replace `github.vscode-github-actions` reclaims
`.github/workflows/` through its own `filenamePatterns`.

### Generated files

`files.readonlyInclude` covers `src/uniwind-types.d.ts`, `expo-env.d.ts`, and
`.expo/types/**` — all machine-regenerated, and AGENTS.md warns specifically
against carrying `router.d.ts` between checkouts. It is editor-only and does not
block the generators.

`src/db/migrations/` is deliberately excluded: a generated migration sometimes
needs a hand-tweak before first application, and locking it would be hostile.

### Search and watcher

`ios/` is prebuild output — ~1.2 GB across ~9,800 files, never hand-edited per
AGENTS.md. It is excluded from search alongside `build/`, `.claude/worktrees/`
(which contains a full `node_modules`), `bun.lock`, and `src/db/migrations/meta`.
`files.watcherExclude` covers `ios/`, `build/`, and `.claude/worktrees/`.

`.expo` is intentionally **not** in the workspace watcher exclusion. If the
workspace object replaces a user-profile one that excluded it, VS Code starts
noticing `.expo/types/router.d.ts` regenerating — an improvement given how often
typed-route staleness bites this repo.

### Explorer

`explorer.fileNesting.patterns` collapses a ~20-file root under `package.json`,
`app.json`, `metro.config.js`, `eslint.config.js`, `tsconfig.json`, and
`README.md`. Setting this replaces VS Code's default patterns; acceptable here
because the defaults mostly target `.js` siblings and npm lockfiles this
Bun-only, TS-only repo does not have.

### `extensions.json`

Recommends what the repo genuinely needs: Expo tools, ESLint, Prettier, Tailwind,
YAML, and GitHub Actions. `unwantedRecommendations: ["biomejs.biome"]` makes VS
Code actively warn a contributor who has Biome installed — the durable guard
against the failure this design exists to fix.

## Verification

- Both files parse as JSONC (`ts.parseConfigFileTextToJson`) and pass
  `prettier --check`.
- All 30 filesystem paths referenced by the config exist.
- Setting names for the extension-contributed keys (`tailwindCSS.classAttributes`,
  `tailwindCSS.classFunctions`, `biome.enabled`) were read from the installed
  extensions' contributed configuration rather than recalled.
- `files.readonlyInclude` requires VS Code ≥ 1.79; installed version is 1.128.0.

## Out of scope

- A Maestro flow YAML schema binding for `.maestro/**` — no schema URL was
  verified, so none was guessed.
- Global-profile hygiene (a dangling Biome default formatter, stale Linux-path
  pins, a global `npm.packageManager: "yarn"` contradicting this repo's Bun-only
  rule). Handled separately in the user profile; not repo state.
