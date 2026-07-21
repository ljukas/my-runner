# Stage 3 — GPS Tracking + Locked-Phone Operation Implementation Plan

> **For agentic workers:** Built with a per-task pipeline — ① an implementation
> agent gathers context + loads skills and *proposes* an approach, ② two
> adversarial reviewers attack the proposal, ③ the orchestrator reconciles, ④ a
> separate code-writer agent implements it, ⑤ the objective gate runs
> (`bun run lint && bun run typecheck && bun test`, plus sim/Maestro where
> applicable). Use `superpowers:test-driven-development` for the pure layers
> (`domain/geo.ts`, batch scheduler, engine distance), `react-native-best-practices`
> + `expo-app-design:building-native-ui` for RN/SwiftUI surfaces, and the argent
> skills for sim verification. **Context7-verify every SDK 57 API before coding**
> (flagged inline). Tasks use checkbox (`- [ ]`) syntax; each states its **review
> surface** (the isolated artifact the two reviewers attack). Follows the C25K
> spec (§4, §5, §6, §11, §13 Stage 3) and ADRs 0003, 0004, 0006, 0007, 0008,
> 0009, 0010, 0013, 0016, 0019, 0021.

**Goal:** The phone goes in a pocket. GPS tracks the route and measures
distance; the run engine keeps deriving segments and speaking cues **while the
screen is locked** — paid-app parity. Distance and pace appear live on the run
screen, on the summary, and in the Log. A killed app offers to resume. Location
denied degrades honestly: the timer stays correct, but cues need the screen on.

**Honest limitation & gate (spec §10, ADR 0008 §7):** the flagship behavior —
30+ min of locked-phone GPS continuity and cue audibility in a release build —
is a **physical-device Milestone-0 gate** and *cannot* be closed on the
simulator. Everything here is written to be unit- and sim-verifiable; the device
spike is a separate external prerequisite before the stage is declared done
(Task 23). If the spike fails, the pre-recorded cue fallback (ADR 0009 §6) is the
pre-decided remedy — an adapter-only swap, out of scope here.

**Base:** stacked on `worktree-hig-audit` (PR #45, Apple HIG audit). Rebase onto
`main` after #45 squash-merges (standard stacked-branch flow).

## Architecture — points-as-spine

The **persisted raw GPS fix stream (`run_points`) is the single source of
truth** for the whole product. Distance, pace, splits, the Stage 4 route
polyline, and the Stage 5 HealthKit route are all *projections* of it — some
live, most read straight from SQLite long after the engine is gone. This is what
the downstream ports literally consume: ADR 0010 `RouteMap` takes
"segments + points", ADR 0011 `HealthAdapter.saveRun` takes `(run, segments, points)`.

```
Per-fix flow (locked phone):
module-scope TaskManager task   ← ~1 Hz background location delivery keeps JS alive (ADR 0008)
  └─ LocationTracker.onFix(fix)                        ← port; adapter owns expo-location
       └─ runEngine.heartbeat(fix.timestamp, fix)      ← ONLY when status==='running'; engine derives segment_seq
            ├─ (timing/cues derived FIRST — never blocked by GPS)
            └─ try { ingest:                            ← wrapped; a throw here must not stall timing
                 ├─ domain/geo: accuracyFilter(≤50m) + haversineMeters(anchor,fix)   ← PURE, unit-tested (reused Stage 4)
                 ├─ running distanceM (display cache) + point tagged with segment_seq
                 └─ batchScheduler (pure ~5s cadence) ─► RunStore.flush(runId, points, state) — ONE txn:
                      ├─ batch-insert points  → run_points          ← incremental, durable spine (spec §5)
                      └─ upsert state         → active_run_snapshot  (event log + watermarks ONLY — tiny, ADR 0007 §5)
               } catch → console.warn, continue

Post-run (engine dead — everything reads the DB):
  finalize() → UPDATE runs: status active→completed/partial, distance_m=Σ, summary_polyline=encode(points)
             + INSERT run_segments (per-segment distance = Σ run_points grouped by segment_seq)  ← DERIVED
  Stage 4 RouteMap ← run_points grouped by segment_seq   (engine-independent)
  Stage 5 HealthAdapter.saveRun(run, segments, points) ← run_points   (engine-independent)
```

Why the engine owns *ingestion* but not *truth*: tagging a fix with the active
`segment_seq` needs the engine's derived segment, so ingestion goes where that
context lives (`heartbeat(now, fix?)`, spec §5 / ADR 0007). But the engine's GPS
state is **ephemeral** — the DB is authoritative. The engine holds only a running
`distanceM` display-cache + the `lastAcceptedFix` haversine anchor; **per-segment
distance is never a stored scalar** — it is derived from `run_points` (grouped by
`segment_seq`) at finalize. On resume, `distanceM` is recomputed from persisted
`run_points`, so there is no second source of truth to diverge. **Pace** (overall
and per-segment) and the **fastest interval** ("best segment") are likewise pure
derivations — computed on demand from persisted per-segment `distance_m` +
`actual_duration_s`, never stored as columns: runs are immutable after finalize,
so nothing can diverge and a pace column would only duplicate truth for no v1
benefit. Persisting per-segment distance is precisely what unlocks the
best-segment highlight. The heavy, review-worthy logic lives in pure modules
(`domain/geo.ts`, `domain/run-stats.ts`, the scheduler) and one DB adapter; the
engine gains only thin, fault-isolated coordination.

## Point persistence & crash-recovery contract (settled — was the #1 review point)

**Mandatory: incremental writes.** Spec §5 ("every ~5s batch-insert points +
upsert `active_run_snapshot` in one transaction") and ADR 0007 §5 ("the snapshot
*is* the event log… tiny… no storage concerns") both require it, and
`PRAGMA foreign_keys = ON` (`src/db/client.ts:6`) means `run_points` cannot be
inserted before a `runs` row exists. Therefore:

- **An in-flight `runs` row is created at `start()`** with a new `'active'`
  status (added to the enum) so `run_points` can FK-reference it during the run.
  This forces one schema change: `runs.status` gains `'active'`. **[Wave A
  ratified]** `ended_at`/`active_duration_s` stay NOT NULL (additive-only
  migration — no table rebuild); `startRun()` inserts placeholders
  (`ended_at = started_at`, `active_duration_s = 0`) and `finalize()` UPDATEs them
  to real values on `active → completed|partial`. **Ripple
  (must be handled, not discovered):** every "completed/partial run" query
  (`src/db/queries.ts`, run-stats, Plan progression, Log) must exclude
  `status = 'active'` — an in-flight or abandoned-unfinalized run is *not* a
  result, and "current session is derived from completed runs" must stay true.
- **`run_points` is written incrementally** (~5s batches) against that `runId`.
- **`active_run_snapshot` carries only** `RunSnapshotState = { sessionKey, events,
  lastAnnouncedIndex, halfwayFired, lastAcceptedFix }` — the event log + two cue
  watermarks + the haversine anchor. **Never the track**, and **no `seq`
  watermark** (resume reloads `run_points` and continues from `max(seq)+1`);
  distance is recomputed from `run_points` on resume. Freshness uses the row's
  `updated_at` (returned by `loadSnapshot`), not event-log age. ADR 0007's
  tiny-snapshot invariant preserved.
- **`finalize()`** flips the `'active'` row to `completed`/`partial`, writes
  `distance_m` (Σ) + `summary_polyline`, and inserts `run_segments` with
  per-segment distance grouped from `run_points`. Clears the snapshot.
- **Crash recovery:** on launch, a fresh `active_run_snapshot` (younger than
  planned session length + 30 min, spec §5) → "Resume run?". Resume reloads the
  track from `run_points` (from `max(seq)+1`), restores the `lastAcceptedFix`
  anchor and recomputes `distanceM`, replays the event log (elapsed stays correct
  — wall-clock math). **Decline / stale → finalize the `'active'` row as
  `partial`** — it already holds real `run_points`, so distance/segments are
  derivable; no silent track loss.

## Global constraints (self-contained — do not chase the removed Stage 1 plan)

From AGENTS.md, the C25K spec, and the ADRs:

- **Purity (ADR 0003/0007):** `domain/` and `engine.ts` import nothing from
  React/Expo/native. `domain/geo.ts` is pure math. Ports are injected at the
  single composition root (`run-engine/index.ts`).
- **Module-scope task (ADR 0003 §6, binding):** the background location task is
  defined at module scope inside the `location-tracker` adapter and registered
  from the app entry — iOS launches it headless; it must not live in React
  lifecycle code. The port exposes only `requestPermission`/`getPermissionStatus`/
  `start`/`stop`/`onFix`; callers never see the task.
- **Tracking config (ADR 0008 §3, binding):** `accuracy: BestForNavigation`,
  `activityType: Fitness`, **`pausesUpdatesAutomatically: false`** (expo defaults
  `true` — a paused stream stops the heartbeat), `showsBackgroundLocationIndicator:
  true`, `distanceInterval: 0`, no deferred updates.
- **Permission posture (ADR 0008 §2):** When-In-Use **only** — never Always.
  Primer-before-prompt; "Not now" always available; denial degrades, never blocks.
- **Location denied (ADR 0008 §5, supersedes spec §11's row):** timer stays
  correct; no background heartbeat → **cues stop while locked**. Run screen says
  so (banner: distance off, cues need the screen on); `useKeepAwake` supports
  screen-on running; Settings deep-links to change it.
- **Timing-first, fault-isolated (spec §11):** GPS/DB work never blocks or throws
  out of the timing/cue path. GPS loss / accuracy > 50 m → track gap, distance
  approximate. DB batch failure → points retained, retried next batch. Console
  only (no analytics).
- **New native deps → fingerprint change → full E2E rebuild** (not repack):
  `expo-location`, `expo-task-manager`, the new permission string, and the
  background modes all bust the `@expo/fingerprint` hash. Expect the slow CI path.
- **No `expo-build-properties` / deployment-target bump** — the iOS 18.0 floor is
  Stage 4 (expo-maps, ADR 0010); nothing in ADR 0008 needs it.
- **Dynamic config (ADR 0019):** `app.json` `plugins` edits flow through
  `app.config.ts` (spreads `config.plugins`). Confirm the variant merge preserves
  `isIosBackgroundLocationEnabled` + both background modes; keep no
  `packageManager: yarn` field (AGENTS.md corepack gotcha).
- **Component conventions (ADR 0013):** reuse `OnboardingStepScreen` (extended —
  Task 16), `FeatureRow`, `SettingsToggle`, `Island.*`; screens compose only. New
  run-HUD metrics follow HIG-audit conventions (Dynamic-Type-aware sizing,
  `monospacedDigit`, 44 pt hit targets, `accessibilityHidden` on decorative
  glyphs, `ConfirmationDialog` for blocking choices, Reduce-Motion safety).
- **E2E (ADR 0016):** text-first selectors; real locked-phone behavior is the
  device gate.

## Tracking configuration (ADR 0008 §3 — binding; Context7-verify enum names)

```ts
// ⚠ Context7-verify SDK 57 exact exports before coding: Accuracy vs LocationAccuracy,
//   ActivityType vs LocationActivityType, and the plugin option isIosBackgroundLocationEnabled.
await Location.startLocationUpdatesAsync(LOCATION_TASK, {
  accuracy: Location.Accuracy.BestForNavigation,
  activityType: Location.ActivityType.Fitness,
  pausesUpdatesAutomatically: false,   // expo defaults true; a paused stream kills the heartbeat
  showsBackgroundLocationIndicator: true,
  distanceInterval: 0,                 // natural ~1 Hz cadence; iOS ignores timeInterval
});
```

## Geo / accuracy rules (`domain/geo.ts`, pure)

- **`LocationFix`** = `{ timestamp, lat, lng, altitude, accuracy, speed }` —
  mirrors the `run_points` columns (spec §4). (No `course`; add only if HealthKit
  later needs it.)
- **`accuracyFilter(fix)`** — accept iff `accuracy != null && accuracy > 0 && accuracy <= 50` m (iOS reports `horizontalAccuracy <= 0` for invalid fixes — Wave A ratified).
- **`haversineMeters(a, b)`** — great-circle delta between two points.
- **Smoothing pipeline (ADR 0021):** distance is `Σ` of deltas over the
  **forward-smoothed** stream, not raw fixes — a velocity/outlier gate, a
  metre-plane forward Kalman (accuracy = measurement variance), a carried-residual
  near-stationary deadband, and a max-gap anchor reset. Forward/causal, so the
  live value equals the finalize/resume recomputation over `run_points`. Plus
  `simplifyPolyline` (Douglas–Peucker) for Stage 4 render (presentation-only —
  distance is never derived from it).
- **`boundingBox(points)`** — min/max lat/lng (Stage 4 camera-fit; built now).
- **`encodePolyline(points, precision = 5)`** — verify against a reference vector.

## File structure (Stage 3 additions/edits)

```
src/
├── domain/
│   ├── geo.ts / geo.test.ts             # NEW: LocationFix, accuracyFilter, haversineMeters, boundingBox, encodePolyline
│   ├── cues.ts / cues.test.ts           # EDIT: add `resuming` cue (phrase, interval category)
│   ├── format.ts / format.test.ts       # EDIT: formatDistanceKm, formatPace (metric only)
│   └── run-stats.ts / run-stats.test.ts # EDIT: paceSecPerKm, segmentPaceSecPerKm, bestRunSegment (derived)
├── services/
│   ├── run-store/
│   │   ├── port.ts                       # NEW: RunStore { appendPoints, saveSnapshot, loadSnapshot, clearSnapshot } + types
│   │   └── index.ts                      # NEW: DB-backed RunStore singleton (src/db)
│   ├── location-tracker/
│   │   ├── port.ts                       # NEW: LocationTracker { requestPermission, getPermissionStatus, start, stop, onFix }
│   │   ├── adapter.ios.ts                # NEW: expo-location; MODULE-SCOPE TaskManager task; ADR 0008 config
│   │   └── index.ts                      # NEW: locationTracker singleton (+ task registration side-effect export)
│   └── run-engine/
│       ├── engine.ts                     # EDIT: heartbeat(now, fix?) ingestion; running distance + anchor; restore(); finalize distance
│       ├── types.ts                      # EDIT: fix param; RunStore + LocationTracker deps; distance fields; live distance/pace on RunSnapshot
│       ├── point-batch-scheduler.ts / .test.ts  # NEW: pure ~5s flush cadence (mirrors release-scheduler.ts)
│       ├── engine.test.ts                # EDIT: fake RunStore/LocationTracker; fixture fix track; distance/tagging/pause/resume assertions
│       └── index.ts                      # EDIT: inject runStore + locationTracker; wire onFix→heartbeat + start/stop; detectResumableRun/resume
├── db/                                   # ← top-level, NOT services/db
│   ├── schema.ts                         # EDIT: runPoints + activeRunSnapshot tables; runs.status +'active'; ended_at nullable
│   ├── queries.ts                        # EDIT: exclude status='active' from result queries
│   ├── save-run.ts                       # EDIT: start-active-row; finalize rollup (distance_m, summary_polyline, per-segment)
│   └── migrations/…                      # NEW: `bun run db:generate`
├── services/onboarding.ts / .test.ts     # EDIT: append location-primer-v1
├── components/onboarding-step-screen.tsx # EDIT: two-action variant (secondary CTA + async primary) — Task 16
└── app/
    ├── _layout.tsx                       # EDIT: async crash-resume gate (Resume run? ConfirmationDialog)
    ├── run.tsx                           # EDIT: live distance/pace row; location-denied banner
    ├── run-summary/[id].tsx              # EDIT: per-segment distance/pace + fastest-interval highlight
    ├── session/[key].tsx                 # EDIT: just-in-time permission ask at first run start
    ├── onboarding/location-primer.tsx    # NEW: primer step (Enable → requestPermission; Not now → skip)
    └── (tabs)/settings/index.tsx         # EDIT: Location status row + Linking.openSettings() when denied
index.js (or app entry)                   # NEW/EDIT: register module-scope location task, then re-export expo-router/entry; repoint package.json "main"
app.json                                  # EDIT: expo-location plugin (+isIosBackgroundLocationEnabled); expo-audio enableBackgroundPlayback: true
.maestro/
├── helpers/launch-and-onboard.yaml       # EDIT: pre-grant location so existing flows don't hang on the prompt
├── helpers/complete-onboarding.yaml      # EDIT: add location-primer step (its two CTAs)
├── helpers/start-first-session.yaml      # EDIT: account for JIT ask if primer was skipped
├── tests/onboarding.yaml                 # EDIT: primer assertNotVisible marker
└── tests/{location-permission,run-denied-path,run-resume}.yaml  # NEW
```

## Build methodology — waves

Every task runs the ①–⑤ pipeline. Tasks are grouped into **dependency waves**;
tasks *within* a wave are independent (code-writers use separate worktrees if
they touch overlapping files); waves are ordered. See the "review surface" on
each task — that is what the two reviewers attack.

- **Wave A (pure/foundational) — ✅ BUILT & committed (2026-07-21):** T1 geo · T2
  format · T2b pace+best-segment · T3 schema+queries+migration · T4 RunStore port ·
  T5 batch scheduler · T6 LocationTracker port. Repo gate green (171 tests,
  typecheck, lint); ratified deltas folded into the contract section + T4/T6/T8.
- **Wave B (adapters/persistence):** T7 RunStore DB adapter · T8 save-run
  (active-row + finalize rollup) · T9 LocationTracker iOS adapter + module-scope
  task · T10 app-entry task registration · T11 app.json/background audio/`resuming` cue.
- **Wave C (engine):** T12 fix ingestion + distance/tagging (pause-gated,
  fault-isolated) · T13 batch-scheduler + snapshot persistence wiring · T14
  resume-rebuild (`restore()`) · T15 composition root + onFix→heartbeat + start/stop
  lifecycle + `detectResumableRun`.
- **Wave D (UI, HIG):** T16 `OnboardingStepScreen` two-action extension · T17
  run-screen distance/pace + denied banner · T17b run-summary per-segment pace +
  fastest-interval highlight · T18 crash-resume dialog · T19 location-primer + JIT
  ask · T20 Settings location row/deep-link.
- **Wave E:** T21 Maestro flows (+ shared-helper pre-grant) · T22 objective gate +
  sim verification · T23 Milestone-0 device checklist (external gate).

## Tasks

### Wave A — pure & foundational

#### T1. `domain/geo.ts` + tests (TDD)
- [ ] RED: `accuracyFilter` (≤50 m / >50 m / null); `haversineMeters` vs known pairs (± tolerance, incl. identical points, antimeridian); `boundingBox` over a fixture; `encodePolyline` vs a reference vector.
- [ ] GREEN: pure functions + `LocationFix`.
- **Review surface:** one pure module + tests. Reviewers check haversine correctness (radius, edge cases), the ≤50 m boundary, empty-array handling.

#### T2. `domain/format.ts` distance/pace formatters (TDD)
- [ ] `formatDistanceKm(m)` (`2.31 km`, metric); `formatPace(secPerKm)` (`6:29 /km`, handles 0/∞ distance). Tests for rounding + degenerate inputs.
- **Review surface:** two pure formatters + tests. Reviewers check rounding, zero-distance pace, locale-free output.

#### T2b. `domain` pace + best-segment helpers (TDD)
- [ ] In `domain/run-stats.ts`: `paceSecPerKm(distanceM, durationS)` (null when `distanceM <= 0`); `segmentPaceSecPerKm(segment)` from its `distance_m` + `actual_duration_s`; `bestRunSegment(segments)` → the fastest `kind === 'run'` segment (lowest pace) with a recorded distance, else `null`. Tests: null/zero-distance, no-run-segment, tie-break.
- **Review surface:** pure helpers + tests. Reviewers check the pace formula (sec/km), the run-only filter, null/zero handling, and that pace stays a derivation (no persisted pace column).

#### T3. DB schema + queries + migration
- [ ] Add `runPoints` (`(runId, seq)` PK, FK → runs, columns per spec §4) + `activeRunSnapshot` (`id` CHECK=1, `stateJson`, `updatedAt`). Add `'active'` to `runs.status`; make `ended_at` nullable; default `active_duration_s`.
- [ ] `queries.ts` + any result query (run-stats, Plan progression, Log): exclude `status = 'active'`.
- [ ] `bun run db:generate`; commit generated `.sql` + `migrations.js`.
- **Review surface:** schema + queries + migration diff. Reviewers check the in-flight-row model, PK/FK, the `status != 'active'` filter is applied *everywhere* results are read, `useLiveQuery` never on `run_points` (ADR 0004 §3), and existing nullable `distance_m`/`summary_polyline` are the write targets.

#### T4. `RunStore` port (types only)
- [x] **[Wave A — built]** `run-store/port.ts` — a single atomic `flush(runId, points, state): Promise<void>` (batch-insert `run_points` + upsert `active_run_snapshot` in ONE txn), `loadSnapshot(): Promise<{ state: RunSnapshotState; updatedAt: string } | null>`, `clearSnapshot(): Promise<void>`. `RunPoint = Omit<LocationFix,'timestamp'> + seq + ISO timestamp + segmentSeq`; `RunSnapshotState` per the contract section (**no track, no seq watermark**).
- **Review surface:** one interface. Reviewers check DB-agnosticism, separation from `RunPersistence.saveRun`, and that `RunSnapshotState` carries no point array.

#### T5. Pure batch scheduler
- [ ] `run-engine/point-batch-scheduler.ts` — mirrors `release-scheduler.ts`: injectable timers, ~5 s coalesced flush callback, idempotent stop, no platform imports. Tests: cadence, coalescing, stop cancels, no flush after stop.
- **Review surface:** one pure module + tests. Reviewers check timer lifecycle, no leaks, determinism under injected clocks.

#### T6. `LocationTracker` port (types only)
- [x] **[Wave A — built]** `location-tracker/port.ts` — `requestPermission()`, `getPermissionStatus()`, `start()`, `stop()`, `onFix(cb): () => void`. Status type exported as **`LocationPermissionStatus`** (`'granted' | 'denied' | 'undetermined'`) — named distinctly from expo-location's own `PermissionStatus` to avoid an adapter import collision (T9). Downstream (T9/T20) import `LocationPermissionStatus`.
- **Review surface:** one interface. Reviewers check no expo-location types leak, `onFix` returns an unsubscribe, permission is queryable + requestable.

#### T6b. `domain/geo.ts` GPS smoothing pipeline (TDD) — ADR 0021
- [ ] Pure, **forward/causal** functions: a velocity/outlier gate (median-window reference, Δt-aware, running-speed ceiling), a constant-velocity Kalman in a **local equirectangular metre plane** about a per-run reference latitude (`accuracy` = measurement variance; fixed `Q`), a **carried-residual** near-stationary deadband (never drops accumulated movement — a 1.4 m/s walker is fully counted), and a max-gap anchor reset. Distance = `Σ` haversine over the smoothed stream. Load-bearing params as named constants (ADR 0021 Parameters). Also `simplifyPolyline` (Douglas–Peucker) for the Stage 4 render (presentation-only).
- **Review surface:** the pure smoothing module + tests. Reviewers check the metre-plane projection (not degrees), that `Q`/deadband don't under-count walking, forward-causal determinism (live == batch), boundary/gap handling, and that DP output never feeds distance.
- **Done when:** `bun test` green on fixture tracks — including a walk-pace track that must not lose distance.

### Wave B — adapters & persistence

#### T7. `RunStore` DB adapter
- [ ] `run-store/index.ts` over `src/db` (reached outside React, ADR 0004): incremental batch-insert `run_points`; single-row (`id=1`) snapshot upsert; both in **one transaction** per flush; load/clear. DB failure → reject so the engine retains + retries (spec §11).
- **Review surface:** one adapter. Reviewers check transaction boundary, single-row snapshot invariant, batch correctness, failure propagation.

#### T8. `save-run.ts`: active-row start + finalize rollup
- [ ] `startRun()` inserts the `'active'` `runs` row (returns `runId`) **with NOT-NULL placeholders `ended_at = started_at`, `active_duration_s = 0`** (columns stay NOT NULL — Wave A). `finalize` UPDATEs it → `completed`/`partial`, writing the real `ended_at`, `active_duration_s`, `distance_m` + per-segment distances **computed by re-running the ADR 0021 forward smoother over `run_points`** (not a raw `Σ haversine`; each smoothed delta attributed to the segment its end fix falls in, so per-segment sums to total), plus `summary_polyline` (via `geo.encodePolyline`) and `run_segments`. Extend `CompletedRunRecord`/`CompletedSegmentRecord` with `distanceM`.
- **Review surface:** record types + `save-run.ts` diff. Reviewers check the active→terminal transition, per-segment distance derivation from points, polyline over the right point set, and the superseded-run generation guard still holds.

#### T9. `LocationTracker` iOS adapter + module-scope task
- [ ] `bun expo install expo-location expo-task-manager` (**Context7-verify SDK 57 API first**). `adapter.ios.ts`: module-scope `TaskManager.defineTask(LOCATION_TASK, …)` mapping `LocationObject[]`→`LocationFix`→`onFix`; `start()` = foreground-permission gate + `startLocationUpdatesAsync(LOCATION_TASK, <binding config>)`; `stop()` = `hasStartedLocationUpdatesAsync` guard + `stopLocationUpdatesAsync`; `requestPermission`/`getPermissionStatus` wrap `requestForegroundPermissionsAsync`/`getForegroundPermissionsAsync`. `index.ts` singleton + task-registration export.
- **Review surface:** adapter + index. Reviewers check module-scope task (not React), the ADR 0008 config verbatim (esp. `pausesUpdatesAutomatically:false`), When-In-Use-only, `LocationObject→LocationFix` fidelity, idempotent start/stop.

#### T10. App-entry task registration
- [ ] Create/repoint the app entry so the module-scope task is evaluated at bundle-eval time on a **headless launch** (expo-router lazily requires routes, so importing it in `_layout.tsx` may not register it). Likely: `index.js` that imports the task side-effect then re-exports `expo-router/entry`; set `package.json` `"main"` accordingly. **Context7/expo-router-verify headless eval.**
- **Review surface:** the entry file + `package.json main` diff. Reviewers check the task is guaranteed-registered on cold/headless launch, and dev-client + Metro still boot.

#### T11. `app.json` background modes + background audio + `resuming` cue
- [ ] `app.json`: add `["expo-location", { locationWhenInUsePermission: "<spec §6 string>", isIosBackgroundLocationEnabled: true }]`; flip `expo-audio` `enableBackgroundPlayback: true`. (`expo-task-manager` needs no plugin entry.)
- [ ] `cue-service/adapter.ios.ts` `prepare()`: add `shouldPlayInBackground: true`.
- [ ] `domain/cues.ts`: add `resuming` cue (phrase "Resuming your workout.", interval category) + `cues.test.ts`; **`adapter.ios.ts` `CUE_HAPTIC` must gain a `resuming` entry** (the `Record<CueId,…>` is exhaustive — else typecheck fails).
- **Review surface:** `app.json` diff + three small code edits. Reviewers check the purpose string (spec §6), both background modes present via the `app.config.ts` merge, no `packageManager: yarn` leak, and `CueId` maps stay exhaustive.

### Wave C — engine

#### T12. Engine fix ingestion + distance/tagging (TDD)
- [ ] RED (`engine.test.ts`, fake RunStore): accepted fixes accumulate distance; >50 m rejected; each point tagged with the current `segment_seq`; **no accumulation while `paused`**; stale/duplicate fix does not inflate distance; ingestion throwing does **not** stall timing/cues; accumulator reset in `start()`/`reset()` before `refresh()`.
- [ ] GREEN: `heartbeat(now, fix?)` — derive timing/cues **first**, then `if (status==='running' && fix)` ingest inside try/catch (log+continue) via the `domain/geo` **forward smoother** (ADR 0021); the engine's in-memory ingest state carries the forward-filter state (position/velocity/covariance/ref-lat/residual) so live `distanceM` **is** the smoothed value; extend `RunSnapshot` with live `distanceM`/pace. The tiny crash snapshot does **not** serialize filter state — resume re-derives it (T14).
- **Review surface:** `engine.ts`/`types.ts` ingestion diff + tests. Reviewers check timing-first ordering, pause gating, fault isolation, ephemeral accumulator (no per-segment scalar), anchor de-dup.

#### T13. Engine batch-scheduler + snapshot persistence wiring
- [ ] Inject `runStore`; arm the batch scheduler on `start()`, flush (`appendPoints` + `saveSnapshot(eventLog+watermarks)`) every ~5 s and on `finalize()`; catch async rejection (retain→retry). Extend the superseded-run generation guard to snapshot/point writes.
- **Review surface:** the scheduler-wiring diff + tests. Reviewers check one-txn flush, watermark advance (no duplicate points), generation-guard coverage, no snapshot track.

#### T14. Engine resume-rebuild (`restore()`)
- [ ] Add a `restore(state)` entry point (bypasses the `idle` guard): re-resolve `PlanSession` from static plan data by `sessionKey` (add a `getSession(key)` helper if absent), replay the event log, reload `run_points` and **re-run the ADR 0021 forward smoother over them** to reconstruct the filter state + `distanceM` (continue appends from `max(seq)+1`). Tests: resume restores elapsed+distance+track; stale snapshot not resumable; recomputed distance matches the pre-crash live value.
- **Review surface:** the `restore()` diff + tests. Reviewers check elapsed correctness post-resume, no double-count vs already-persisted points, anchor restoration (else first post-resume delta dropped).

#### T15. Composition root + GPS↔engine wiring + resume detection
- [ ] `run-engine/index.ts`: inject `runStore` + `locationTracker`; **subscribe `locationTracker.onFix → runEngine.heartbeat(fix.timestamp, fix)` in module scope** (survives lock — NOT a React effect); call `locationTracker.start()` on run start and `stop()` on finalize/reset. Export async `detectResumableRun()` (freshness rule) + `resume()`.
- **Review surface:** the composition diff. Reviewers check the subscription is outside React lifecycle, start/stop lifecycle is tied to the engine (not the screen), single composition root, and the freshness threshold (planned length + 30 min).

### Wave D — UI (HIG)

#### T16. `OnboardingStepScreen` two-action extension
- [ ] Add a secondary-CTA slot + an async-capable primary (`secondaryLabel`/`onPrimaryPress`, or a two-action variant), preserving the existing single-CTA default. Verify `welcome`/`audio-cues` render unchanged.
- **Review surface:** the component diff (ADR 0013 — a shared domain component, its own surface). Reviewers check the existing two screens are untouched in behavior and the new slot is optional.

#### T17. Run screen: live distance/pace + denied banner
- [ ] `tone="secondary"` `monospacedDigit` distance/pace row in the `VStack` (below elapsed/total), from the engine snapshot; hidden/placeholder when location off. Location-denied SwiftUI banner (top of `VStack`) linking to Settings.
- **Review surface:** `run.tsx` diff. Reviewers check HIG (Dynamic-Type, `accessibilityHidden`, RN-leaf-needs-View-wrapper), snapshot-only (no engine coupling in the view), Reduce-Motion safety.

#### T17b. Run summary: per-segment distance/pace + fastest-interval highlight
- [ ] On `src/app/run-summary/[id].tsx`: overall avg pace + total distance (derived); the per-segment table shows each segment's distance + pace (`segmentPaceSecPerKm`); visually **highlight the fastest interval** (`bestRunSegment`) — a "Fastest" badge/accent on that row. HIG-audit idioms (`StatGrid`/`StatList`, `monospacedDigit`, Dynamic-Type). No-GPS fallback: no distance → hide pace/highlight, keep the time-based summary.
- **Review surface:** the run-summary diff. Reviewers check derivation-only (no stored pace), correct fastest-segment selection, graceful no-GPS fallback, and HIG conformance.

#### T18. Crash-resume "Resume run?" dialog
- [ ] `_layout.tsx`: after the migrations gate, `await detectResumableRun()`; if resumable, present a `ConfirmationDialog` (Resume · Discard). Resume → `resume()` + `router.push('/run')` + `cueService.announce('resuming')` (routes through the `index.ts` gate). Discard → finalize `partial`.
- **Review surface:** `_layout.tsx` diff. Reviewers check the **async** load is sequenced correctly relative to the migrations + OnboardingGate, no double-present on re-render, and the resume cue is gated.

#### T19. Location-primer onboarding + JIT ask
- [ ] `onboarding.ts`: append `{ id: 'location-primer-v1', route: '/onboarding/location-primer' }`; update `onboarding.test.ts`. `location-primer.tsx`: the Task-16 two-action screen — "Enable location" → `locationTracker.requestPermission()` then advance; "Not now" → advance. `session/[key].tsx`: first run start, if permission undetermined + primer skipped, ask just-in-time before `start()`; denied → timer-only.
- **Review surface:** onboarding diff + step screen + JIT hook. Reviewers check primer-before-prompt (never cold), "Not now" present, versioned append (existing users see only this step), denial still starts the run.

#### T20. Settings: location status + deep-link
- [ ] `(tabs)/settings/index.tsx`: a "Location" row reflecting live status; when denied, a Button → `Linking.openSettings()` (no toggle — permission isn't app-flippable). Fits the SwiftUI `Form`/`Section` idiom.
- **Review surface:** settings diff. Reviewers check live status read, deep-link only when denied, and the "unverified Settings large-title inset" HIG follow-up isn't regressed.

### Wave E — E2E & gate

#### T21. Maestro flows
- [ ] `helpers/launch-and-onboard.yaml`: **pre-grant location** (`launchApp: { permissions: { location: allow } }`) so the 4 existing flows don't hang on the prompt; `complete-onboarding.yaml`: add the primer step (its two CTAs); `start-first-session.yaml`: handle a JIT ask if "Not now" was tapped; `onboarding.yaml`: add the primer `assertNotVisible` marker.
- [ ] NEW `tests/location-permission.yaml` (allow/deny stubs), `tests/run-denied-path.yaml` (denied → completes, banner asserted), `tests/run-resume.yaml` (start → `stopApp`/relaunch → Resume → completes; distance asserted via `setLocation`).
- [ ] **Verify `launchApp.permissions` values + `setLocation` syntax via the Maestro `cheat_sheet` tool** — first use in this repo.
- **Review surface:** the flow YAML diffs. Reviewers check text-first selectors (ADR 0016), the new permission/`setLocation` primitives, the shared-helper pre-grant fixes all downstream flows, and e2e `appId`.

#### T22. Objective gate + sim verification
- [ ] `bun run lint && bun run typecheck && bun test` green. argent sim: denied-path completes with banner; resume-after-kill works; distance/pace render (mocked location); primer allow/deny.
- **Review surface:** aggregate diff + gate output. Final reconciliation pass. (Lukas runs the full Maestro suite — never run `bun run e2e` here; keep e2e JS + flows fresh, flag anchor changes at handoff.)

#### T23. Milestone-0 device checklist (external gate — documented, not run here)
- [ ] Document the physical-device checklist (spec §10, ADR 0008 §7): release-config build on a real iPhone — 30+ min locked-phone GPS continuity, TTS audibility while locked, Spotify duck+recover, silent switch, Bluetooth headphones, phone-call interruption. TTS-while-locked failure → pre-recorded cue fallback (ADR 0009 §6).
- **Done when:** checklist committed; stage is **not** declared complete until Lukas runs it on-device.

## Exit criteria (spec §13)

A real 30-min outdoor run, phone locked, music playing → correct cues, route
data, and distance (the **device gate**, T23). Verifiable in-repo: distance/pace
live + summary + Log (incl. per-segment pace and the fastest-interval highlight);
permission primer allow/deny; denied-path session completes
with the honest banner; resume-after-kill restores elapsed + track;
`lint`/`typecheck`/`bun test` green; stage Maestro flows pass. Map rendering
remains a documented Stage 4 gap.

## Deliberately absent (Stage 4+)

Route **rendering** (segment-colored polylines from the **DP-simplified smoothed
track**, markers, camera-fit — Stage 4, expo-maps, iOS 18.0 floor, ADR 0021 §6); Apple Health write (Stage 5); the pre-recorded cue
fallback adapter (built only if Milestone-0 fails); `course` on `LocationFix`
(add only if HealthKit needs it); Android location adapter (port shape reserved,
ADR 0008 §Consequences).
