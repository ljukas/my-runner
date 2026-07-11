# Migrate npm → Bun Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch this Expo SDK 57 app from npm to Bun as package manager and script runner, with identical dependency versions and a verified working dev server.

**Architecture:** Bun replaces npm only for installing and launching — Metro, `expo prebuild`, and the dev server still run on Node. Expo CLI and EAS Build auto-detect the package manager from the lockfile, so the migration is: produce `bun.lock` (migrated from `package-lock.json`, versions preserved), delete `package-lock.json`, update docs. No app code changes.

**Tech Stack:** Bun 1.3.14 (installed at `/opt/homebrew/bin/bun`), Node v23.10.0, Expo SDK 57, expo-router, TypeScript ~6.0.

## Global Constraints

- **Dependency versions must not change.** `bun install` migrates resolutions from `package-lock.json`; verify spot-check versions match before deleting the old lockfile.
- **`bun.lock` becomes the ONLY lockfile.** Expo CLI (`npx expo install`) and EAS Build pick the package manager by lockfile; a leftover `package-lock.json` would fight the detection ([Expo Bun guide](https://docs.expo.dev/guides/using-bun/)).
- **No `trustedDependencies` needed.** Scan of `node_modules` found zero packages with `preinstall`/`install`/`postinstall` scripts.
- **Do not run `bun run reset-project`** — it deletes the starter screens.
- **Do not scaffold ESLint** — `expo lint` first-run scaffolds a config; that's out of scope for this migration, so skip lint in verification.
- Sources: [Using Bun (Expo)](https://docs.expo.dev/guides/using-bun/), [Bun lockfile migration](https://bun.com/docs/pm/lockfile), [bun ci](https://bun.com/docs/pm/cli/install).

---

### Task 1: Produce `bun.lock` and retire `package-lock.json`

**Files:**
- Create: `bun.lock` (generated)
- Delete: `package-lock.json`

**Interfaces:**
- Consumes: existing `package-lock.json` resolutions.
- Produces: committed `bun.lock` that Task 2's docs and Task 3's verification rely on; Expo CLI detects Bun from it.

- [ ] **Step 1: Record current versions of anchor packages (pre-migration baseline)**

```bash
node -e 'const f=p=>JSON.parse(require("fs").readFileSync("node_modules/"+p+"/package.json")).version;["expo","react","react-native","expo-router","typescript"].forEach(p=>console.log(p,f(p)))' | tee /tmp/pre-bun-versions.txt
```

Expected: five lines like `expo 57.x.x`, `react 19.2.x`, `react-native 0.86.x`, saved to `/tmp/pre-bun-versions.txt`.

- [ ] **Step 2: Run `bun install` (auto-migrates the npm lockfile)**

```bash
bun install
```

Expected: completes without error; `bun.lock` now exists at repo root; `package-lock.json` still present (Bun preserves the original).

- [ ] **Step 3: Verify versions were preserved**

```bash
node -e 'const f=p=>JSON.parse(require("fs").readFileSync("node_modules/"+p+"/package.json")).version;["expo","react","react-native","expo-router","typescript"].forEach(p=>console.log(p,f(p)))' | diff /tmp/pre-bun-versions.txt -
```

Expected: no output (exit 0) — identical versions. **If this diff is non-empty, stop: do not delete `package-lock.json`; investigate before proceeding.**

- [ ] **Step 4: Delete `package-lock.json` so Bun is the sole detected manager**

```bash
rm package-lock.json
ls package-lock.json bun.lock 2>&1
```

Expected: `ls` errors on `package-lock.json` (No such file) and lists `bun.lock`.

- [ ] **Step 5: Prove a clean reproducible install from `bun.lock` alone**

```bash
rm -rf node_modules && bun ci
```

Expected: install succeeds, exit 0, no lockfile changes (`git status --porcelain bun.lock` is empty). Re-run Step 3's version check → still identical.

- [ ] **Step 6: Confirm `.gitignore` doesn't exclude the lockfile**

```bash
git check-ignore bun.lock; echo "exit=$?"
```

Expected: `exit=1` (not ignored).

- [ ] **Step 7: Commit**

```bash
git add bun.lock package-lock.json
git commit -m "build: migrate package manager from npm to bun"
```

---

### Task 2: Update AGENTS.md commands to Bun

**Files:**
- Modify: `AGENTS.md` (the `# Commands` section)

**Interfaces:**
- Consumes: `bun.lock` from Task 1 (docs claim Bun detection, which requires it).
- Produces: accurate onboarding commands for future contributors/agents.

- [ ] **Step 1: Replace the `# Commands` section body with:**

```markdown
This project uses **Bun** as its package manager and script runner — `bun.lock` is the only lockfile, and Expo CLI/EAS Build auto-detect Bun from it. Metro and the dev server still run on Node (keep a Node LTS installed); Bun handles installing and launching.

- `bun install` — install dependencies (`bun ci` for a frozen, reproducible install)
- `bun expo install <package>` — add a dependency at the Expo SDK-compatible version (use this instead of `bun add` for anything Expo touches)
- `bun run start` (or `bun expo start`) — start the dev server; press `i`/`a`/`w` for iOS simulator, Android emulator, or web
- `bun run ios` / `bun run android` / `bun run web` — start directly on a platform
- `bun run lint` — `expo lint`; no ESLint config is committed yet, so the first run scaffolds one
- No test runner is configured yet
- `bun run reset-project` — template script that moves the starter code aside and creates a blank `src/app/`; don't run it casually
```

Keep the trailing paragraph about `/ios` and `/android` being gitignored unchanged.

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: document bun as the package manager in AGENTS.md"
```

---

### Task 3: Verify the migrated project end-to-end

**Files:** none modified — verification only.

**Interfaces:**
- Consumes: `bun.lock` + reinstalled `node_modules` from Task 1.

- [ ] **Step 1: Expo CLI detects Bun and dependency versions are SDK-correct**

```bash
bun expo install --check
```

Expected: exit 0, output says dependencies are up to date / no changes needed. (If it proposes changes, that predates the migration — report, don't auto-apply.)

- [ ] **Step 2: Project health check**

```bash
bunx expo-doctor
```

Expected: all checks pass (`15/15 checks passed` or similar). Network-dependent; a warning about a new SDK release is acceptable, failures are not.

- [ ] **Step 3: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: exit 0, no errors.

- [ ] **Step 4: Boot the dev server via Bun and confirm it serves**

```bash
CI=1 bun run web > /tmp/expo-web.log 2>&1 &
sleep 20 && curl -s -o /dev/null -w "%{http_code}" http://localhost:8081
```

Expected: `200`. Then stop the server (`kill %1` or kill the expo process). Check `/tmp/expo-web.log` for "Waiting on http://localhost:8081" and no red error output.

- [ ] **Step 5: Report** — summarize version-diff result, doctor/tsc/dev-server outcomes to the user.
