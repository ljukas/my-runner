# E2E Fingerprint-Gated `.app` Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `e2e-ios` CI job reuse a fingerprint-keyed cached native simulator `.app` — repacking only the JS with `@expo/repack-app` when native is unchanged, and doing a full `eas build --local` only on a native (fingerprint) change.

**Architecture:** Add a fingerprint step + `actions/cache` (keyed on the `@expo/fingerprint` hash) to `.github/workflows/e2e.yml`. Cache miss → full build, extract `.app`, cache it. Cache hit → `@expo/repack-app` swaps in the current commit's JS (regenerating the expo-updates manifest). A shared shell script holds the build-and-extract logic (used by the miss path and the repack fallback). No product-code or `app.json` changes.

**Tech Stack:** GitHub Actions, `actions/cache@v4`, EAS CLI (`--local`), `@expo/fingerprint` (via `expo-updates fingerprint:generate`), `@expo/repack-app`, Maestro, Bun.

## Global Constraints

- Build runner is **`macos-26`** (Xcode 26 — required by Expo SDK 57 / RN 0.86); still a free standard runner for public repos.
- Package manager is **Bun**; `.bun-version` = `1.3.14`. `EXPO_TOKEN` is a repo secret (needed for `eas build --local` on the miss and fallback paths).
- **Fingerprint command (validated, = EAS's `runtimeVersion` hash):** `npx expo-updates fingerprint:generate --platform ios 2>/dev/null | jq -r '.hash'` → 40-char hex, stable across runs.
- **`@expo/repack-app` default mode** (NOT `--js-bundle-only`): regenerates JS bundle + assets + the expo-updates embedded manifest, skipping native compile. iOS simulator `.app` is supported (`--source-app <x>.app`, output matches input).
- **Never** modify `app.json`, `fingerprint.config.js`, `cli.appVersionSource`, or `runtimeVersion` (ADR 0012 / AGENTS.md).
- Every new build/cache/fingerprint/repack/boot step keeps the existing `if: steps.decide.outputs.run == 'true'` guard, so docs-only PRs still short-circuit and the required check never hangs.
- Job id stays **`e2e-ios`** (no `name:` override) — it is the required status-check context on ruleset 18800808.
- This is a **workflow + docs change only** — no product code, so `bun test` / `bun run typecheck` / `bun run lint` are unaffected and need not run (the gate itself is CI-verified in Task 3).
- `actions/cache` key = fingerprint hash alone; `main`'s cache scope is restorable from PR branches (the first `main` build after merge primes the cache for all PRs).

---

### Task 1: Fingerprint-gated build/repack in `e2e.yml` + shared build script

**Files:**
- Create: `.github/scripts/build-e2e-sim-app.sh`
- Modify: `.github/workflows/e2e.yml` (replace the build + extract/boot steps; lines 72–98 today)

**Interfaces:**
- Produces: unchanged external contract — the job still ends by running `maestro test .maestro/` against a booted simulator with the app installed; job id stays `e2e-ios`.

- [ ] **Step 1: Create the shared build-and-extract script**

Create `.github/scripts/build-e2e-sim-app.sh`:

```bash
#!/usr/bin/env bash
# Build the e2e-simulator app via `eas build --local` and extract the .app.
# Usage: bash .github/scripts/build-e2e-sim-app.sh <dest-dir>
# Result: <dest-dir>/app.app  (requires EXPO_TOKEN in the environment).
set -euo pipefail

DEST="$1"
mkdir -p "$DEST"

bunx eas-cli build \
  --platform ios \
  --profile e2e-simulator \
  --local \
  --non-interactive \
  --output "$DEST/app.tar.gz"

tar -xzf "$DEST/app.tar.gz" -C "$DEST"
rm -f "$DEST/app.tar.gz"

APP=$(find "$DEST" -maxdepth 3 -name '*.app' -type d | head -1)
if [ -z "$APP" ]; then
  echo "::error::no .app found after extracting the EAS build output" >&2
  exit 1
fi
if [ "$APP" != "$DEST/app.app" ]; then
  mv "$APP" "$DEST/app.app"
fi
echo "Built: $DEST/app.app"
```

- [ ] **Step 2: Syntax-check the script**

Run:
```bash
bash -n .github/scripts/build-e2e-sim-app.sh && echo "syntax ok"
command -v shellcheck >/dev/null && shellcheck .github/scripts/build-e2e-sim-app.sh || echo "shellcheck not installed — skipped"
```
Expected: `syntax ok`; shellcheck clean if installed.

- [ ] **Step 3: Replace the build + extract/boot steps in `e2e.yml`**

In `.github/workflows/e2e.yml`, replace the two steps currently spanning "Build E2E simulator app (local — zero EAS cloud minutes)" through "Extract app and boot a simulator" (the block from `- name: Build E2E simulator app` down to the `echo "udid=$UDID" >> "$GITHUB_OUTPUT"` line) with this block. Leave every other step (checkout, decide, Set up Bun, Set up Java, Install dependencies, Install Maestro, Run Maestro suite, Upload artifacts) exactly as-is:

```yaml
      - name: Compute native fingerprint
        if: steps.decide.outputs.run == 'true'
        id: fp
        run: |
          HASH=$(npx expo-updates fingerprint:generate --platform ios 2>/dev/null | jq -r '.hash')
          if [ -z "$HASH" ] || [ "$HASH" = "null" ]; then
            echo "::error::fingerprint generation failed"; exit 1
          fi
          echo "hash=$HASH" >> "$GITHUB_OUTPUT"
          echo "Native fingerprint: $HASH"

      - name: Restore cached native .app (keyed by fingerprint)
        if: steps.decide.outputs.run == 'true'
        id: cache
        uses: actions/cache@v4
        with:
          path: ${{ runner.temp }}/native-app
          key: e2e-native-app-ios-${{ steps.fp.outputs.hash }}

      - name: Build E2E simulator app (cache miss — full native build, zero EAS cloud minutes)
        if: steps.decide.outputs.run == 'true' && steps.cache.outputs.cache-hit != 'true'
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
        run: bash .github/scripts/build-e2e-sim-app.sh "$RUNNER_TEMP/native-app"

      - name: Repack cached .app with current JS (cache hit — no native build)
        if: steps.decide.outputs.run == 'true' && steps.cache.outputs.cache-hit == 'true'
        id: repack
        continue-on-error: true
        run: |
          npx @expo/repack-app --platform ios \
            --source-app "$RUNNER_TEMP/native-app/app.app" \
            -o "$RUNNER_TEMP/repacked.app"

      - name: Fallback to a full build (repack failed)
        if: steps.decide.outputs.run == 'true' && steps.cache.outputs.cache-hit == 'true' && steps.repack.outcome == 'failure'
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
        run: |
          echo "::warning::@expo/repack-app failed; falling back to a full native build"
          bash .github/scripts/build-e2e-sim-app.sh "$RUNNER_TEMP/fallback"

      - name: Boot simulator and install app
        if: steps.decide.outputs.run == 'true'
        id: sim
        run: |
          if [ "${{ steps.cache.outputs.cache-hit }}" = "true" ] && [ "${{ steps.repack.outcome }}" != "failure" ]; then
            APP_PATH="$RUNNER_TEMP/repacked.app"
          elif [ "${{ steps.cache.outputs.cache-hit }}" = "true" ]; then
            APP_PATH="$RUNNER_TEMP/fallback/app.app"
          else
            APP_PATH="$RUNNER_TEMP/native-app/app.app"
          fi
          echo "Installing: $APP_PATH"
          UDID=$(xcrun simctl list devices available --json \
            | jq -r '[.devices[][] | select(.name | test("^iPhone"))] | last | .udid')
          echo "Simulator UDID: $UDID"
          xcrun simctl boot "$UDID"
          xcrun simctl bootstatus "$UDID" -b
          xcrun simctl install "$UDID" "$APP_PATH"
          echo "udid=$UDID" >> "$GITHUB_OUTPUT"
```

(The `Run Maestro suite` step already consumes `${{ steps.sim.outputs.udid }}`, so it needs no change — the `sim` step id is preserved.)

- [ ] **Step 4: Validate the workflow YAML**

Run:
```bash
node -e "require('fs').readFileSync('.github/workflows/e2e.yml','utf8')" && echo "readable"
command -v actionlint >/dev/null && actionlint .github/workflows/e2e.yml || echo "actionlint not installed — skipped"
grep -c "steps.decide.outputs.run == 'true'" .github/workflows/e2e.yml
```
Expected: `readable`; actionlint clean if installed; the `run == 'true'` guard count covers every heavy step (fingerprint, cache, build, repack, fallback, boot, install-maestro, maestro — 8+, plus the artifact step's `failure() && …`).

- [ ] **Step 5: Commit**

```bash
git add .github/scripts/build-e2e-sim-app.sh .github/workflows/e2e.yml
git commit -m "ci: fingerprint-gated E2E .app reuse (repack on cache hit, build on miss)"
```

---

### Task 2: Document the two-path gate

**Files:**
- Modify: `docs/adr/0001-local-first-maestro-e2e-testing.md`
- Modify: `AGENTS.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Extend the ADR 0001 amendment**

Append this paragraph to the end of the existing "## Amendment (2026-07-13): GitHub Actions is the CI gate" section in `docs/adr/0001-local-first-maestro-e2e-testing.md`:

```markdown
The `e2e-ios` job caches the built native simulator `.app` in `actions/cache`
keyed by the `@expo/fingerprint` hash (the same hash that drives
`runtimeVersion`). On a fingerprint hit — a PR that changes only JS — it skips
the native build and refreshes the JS with `@expo/repack-app` (which also
regenerates the expo-updates embedded manifest), cutting a run from ~25 min to
~5–7 min; a fingerprint miss (a native change) does the full `eas build --local`
and re-primes the cache. Design:
`docs/superpowers/specs/2026-07-13-e2e-fingerprint-app-reuse-design.md`.
```

- [ ] **Step 2: Add a note to the AGENTS.md E2E section**

In `AGENTS.md`, under "# E2E tests (Maestro)", add this bullet immediately after the existing "**Run:**" bullet:

```markdown
- **CI build reuse:** the `e2e-ios` workflow caches the native simulator `.app`
  by `@expo/fingerprint` hash — JS-only PRs skip the build and repack the JS via
  `@expo/repack-app` (~5–7 min); native changes trigger a full `eas build
  --local` and re-cache. See the fingerprint-reuse design spec.
```

- [ ] **Step 3: Verify the doc edits**

Run:
```bash
grep -q "@expo/repack-app" docs/adr/0001-local-first-maestro-e2e-testing.md && grep -q "CI build reuse" AGENTS.md && echo "docs updated"
```
Expected: `docs updated`.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0001-local-first-maestro-e2e-testing.md AGENTS.md
git commit -m "docs: document fingerprint-gated E2E .app reuse (ADR 0001, AGENTS.md)"
```

---

### Task 3: PR, then verify miss → hit end-to-end (controller-gated — leaves the machine)

**Files:** none (verification + repo interaction).

**Interfaces:** consumes Tasks 1–2.

- [ ] **Step 1: Push the branch and open a PR**

```bash
git push -u origin worktree-e2e-fingerprint-cache
gh pr create --title "ci: fingerprint-gated E2E .app reuse" \
  --body "Implements docs/superpowers/specs/2026-07-13-e2e-fingerprint-app-reuse-design.md — cache the native simulator .app by @expo/fingerprint hash; repack JS on hit (~5-7min), full eas build --local on native change."
```

- [ ] **Step 2: Verify the cache-MISS path (first run on this fingerprint)**

Watch `e2e-ios`. Because this PR touches `.github/**` (app-affecting) and the fingerprint is (likely) not yet cached, expect: fingerprint computed, cache miss, full `eas build --local`, `.app` extracted and cached, Maestro 3/3 green. Confirm the log shows `Cache not found` / a save at job end.

- [ ] **Step 3: Verify the cache-HIT path (JS-only follow-up)**

Push a JS-only commit (e.g., a trivial visible copy tweak in `src/`) to the PR branch. On the new run expect: same fingerprint → **cache hit**, the repack step runs (no `eas build`), total time ~5–7 min, Maestro 3/3 green. Confirm the Maestro screenshots reflect the new JS (freshness), proving the repacked app runs current code, not the cached JS. Then revert the throwaway tweak if it was only for verification.

- [ ] **Step 4: (If it surfaces) confirm the fallback**

If any run shows the repack step failing, confirm the "Fallback to a full build" step runs and the job still goes green. No action needed unless repack proves flaky.

- [ ] **Step 5: Merge**

Once `e2e-ios` (and `checks`) are green and reviewed, squash-merge under the `ci:` title. The first `push` to `main` after merge primes the cache for that fingerprint so subsequent PRs hit.

---

## Self-review notes

- **Spec coverage:** fingerprint step (Decision 1) → T1 S3; `actions/cache` key = fingerprint (Decision 2) → T1 S3; repack default-mode on hit → T1 S3; repack-failure fallback (Decision 3) → T1 S3 (`continue-on-error` + fallback step); no app.json/config change (Decision 4) → honored (no such files touched); correctness/freshness → verified in T3 S3; docs → T2.
- **No placeholders:** the fingerprint command, repack invocation, cache key, and full YAML block are concrete and (for the fingerprint) empirically validated.
- **Type/name consistency:** step ids `decide` / `fp` / `cache` / `repack` / `sim` are referenced consistently; `sim.outputs.udid` feeds the unchanged Maestro step; `native-app/app.app` is the single normalized native-app path written by the script and read by the boot step and repack source.
