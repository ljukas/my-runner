# Couch-to-5K App — Design Spec

**Date:** 2026-07-11
**Status:** Approved pending final user review
**Target:** iOS-only v1 · Expo SDK 57 · React Native 0.86 · React 19.2 · TypeScript ~6.0 · Bun

## 1. Overview

A free, local-first Couch-to-5K app. It guides someone who can barely run through the classic 9-week walk/run program (3 sessions/week, ~30 min each) until they can run 5 km. During a session the app times each walk/run segment, speaks audio cues ("Start running", "Start walking") — including with the phone locked in a pocket while music plays — records the GPS route, and afterwards shows the run on a map with per-segment splits. All data lives on-device in SQLite.

### Hard constraints (from AGENTS.md)

- No backend, no accounts, no analytics. All data on-device; iCloud device backup is the v1 safety net.
- Mobile only: iOS primary target, Android secondary. No web target (react-native-web removed from the repo).
- Never edit native projects; everything via app.json + config plugins (CNG).
- Prefer Expo-official packages; `@expo/ui` (SwiftUI) for UI wherever it earns it.

### Decisions log (agreed 2026-07-11)

| Topic | Decision |
|---|---|
| Program | Classic 9-week C25K, **NHS interval structure** (5-min warmup + cooldown walks every session; W6R3 = 25 min continuous) |
| Background | Full background operation: GPS + spoken cues with screen locked |
| Maps | **expo-maps** (alpha, iOS 18.0 min deployment target accepted); react-native-maps pre-approved fallback |
| Cue audio | **TTS (expo-speech)** over a configured expo-audio session; early device spike; pre-recorded files as fallback behind the same interface |
| Cue language | English only |
| Cue richness | Transitions + milestones (~10 phrases) |
| Run controls | Pause/resume, skip segment, end early (partial save) |
| Screen-awake mode | Run-screen toggle (default on, persisted): keep display awake all run — glanceable + preserves a foreground haptic cue accent channel (added 2026-07-11 review; ADR 0009) |
| Auto-pause | No — interval timer is wall-clock based and never self-pauses |
| Progression | Linear with free repeat: next session highlighted, any earlier session can be redone |
| Completion | Time-based: finishing the interval sequence completes the session, regardless of distance |
| Crash recovery | Offer to resume; elapsed recomputed from wall-clock |
| Storage | expo-sqlite + Drizzle ORM; live queries via `useLiveQuery` |
| Backup/sync | iCloud device backup now (zero-code); schema designed **sync-agnostic** (UUIDs, `updated_at`, soft deletes) — no commitment to a specific sync mechanism |
| Health | Write workouts (incl. GPS route) to Apple Health via `@kingstinct/react-native-healthkit`, behind a platform port |
| Platform strategy | **Ports & adapters**: every platform-touching capability behind a TS interface; iOS adapters in v1, Android adapters plug in later |
| Navigation | **All modal surfaces are expo-router screens** with native `presentation` options (fullScreenModal, formSheet…). Native feel first; reach outside native elements only when needed |
| Units | Kilometers only |
| History | List + run detail (map, splits); no aggregate dashboards in v1 |
| Tabs | Plan / History / Settings (NativeTabs) |
| Live Activity | Deferred to v2 (official expo-widgets identified as the path) |
| Data export | Deferred to v2 |
| Delivery | **5 incremental stages, each a working app** (§13); a separate implementation plan per stage follows this spec |
| Onboarding | Versioned first-launch flow from Stage 1; each stage that needs a permission adds a step; **primer-before-prompt** for every permission, "Not now" always available |
| E2E | Maestro from Stage 1 (tooling already configured — ADR 0001), enabled by a dev-only compressed plan; every stage ships flows for its new surface |

## 2. Packages

New installs via `bun expo install` unless noted. Already present: `@expo/ui`, `expo-glass-effect`, `expo-symbols`, `expo-router`.

| Package | Role | Notes |
|---|---|---|
| `expo-sqlite` | Local DB + `kv-store` for settings | Official; DB file in `Documents/SQLite` → included in iCloud device backup automatically |
| `drizzle-orm` (`bun add`); `drizzle-kit` + `babel-plugin-inline-import` (`bun add -d`) | Typed schema, generated migrations, `useLiveQuery` | Pure JS on top of expo-sqlite; requires `enableChangeListener: true` |
| `expo-location` + `expo-task-manager` | Foreground + background GPS | When-In-Use permission only; background via `startLocationUpdatesAsync` |
| `expo-speech` | TTS cues | Thin AVSpeechSynthesizer wrapper; rides the app audio session |
| `expo-audio` | Audio session config | `playsInSilentMode`, `shouldPlayInBackground`, `duckOthers`; plugin adds `UIBackgroundModes: audio` |
| `expo-maps` | Route map (Apple Maps, SwiftUI MapKit) | **Alpha**; polylines with per-polyline color/width confirmed in SDK 57; iOS 18.0 min |
| `expo-keep-awake` | Screen stays on during visible run screen | UX only, not a background strategy |
| `expo-crypto` | `Crypto.randomUUID()` for row IDs | |
| `expo-build-properties` | `ios.deploymentTarget: "18.0"` | Required by expo-maps |
| `expo-dev-client` | Dev builds | Expo Go cannot run this app (maps, HealthKit, background location) |
| `@kingstinct/react-native-healthkit` v14 + `react-native-nitro-modules` | Apple Health workout writes | New-Arch (Nitro); Expo config plugin; iOS-only, boxed behind `HealthAdapter` |

Explicitly rejected: Mapbox (account/token/telemetry/metering conflict with no-backend ethos), WatermelonDB/TinyBase/LiveStore (wrong fit or oversized buy-in), react-native-health (stale ~21 months).

## 3. Architecture

```
src/
├── app/                    # expo-router routes (thin shells — navigation & composition only)
├── components/             # SwiftUI islands (@expo/ui Hosts) + RN shells (RouteMap, themed primitives)
├── db/                     # Drizzle schema, generated migrations, client, query helpers
├── domain/                 # PURE TypeScript — no React, no Expo imports
│   ├── plan.ts             #   27 NHS sessions as static seed data (appendix A)
│   │                       #   + dev-only compressed variant (seconds-long segments) for E2E/demos
│   ├── segments.ts         #   segment derivation math (elapsed → current segment)
│   ├── geo.ts              #   haversine distance, accuracy filter, polyline encode
│   └── format.ts           #   km/pace/duration formatting (metric only)
└── services/               # stateful singletons behind ports
    ├── run-engine/         #   timestamp state machine (the heart)
    ├── location-tracker/   #   expo-location wrapper + module-scope TaskManager task
    ├── cue-service/        #   audio session + TTS behind swappable interface
    └── health/             #   HealthAdapter port + healthkit.ios.ts adapter
```

**Data flow during a run:** background location task fires ~1/s → `RunEngine.heartbeat(now, fix)` → derives current segment from wall-clock → on derived-segment change fires `CueService.announce()` → persists snapshot + batches GPS points → notifies UI via `useSyncExternalStore`. Plan/History screens never touch the engine; they read SQLite through `useLiveQuery`, so a finished run refreshes them automatically.

The training plan is **static TypeScript data**, not DB rows. The DB stores only results.

**State management:** no new state library. The engine exposes `subscribe`/`getSnapshot` consumed with React's `useSyncExternalStore`; settings and onboarding progress (`completed_steps`, versioned step ids) live in `expo-sqlite/kv-store`; everything else is derived from the DB via live queries.

## 4. Data model

Sync-agnostic rules (applies to every table): UUID v4 primary keys (`expo-crypto`), `created_at`/`updated_at` (ISO-8601 UTC), soft-delete via `deleted_at`. No sync mechanism is chosen; these columns make any future diff/merge layer possible without schema migration.

```
runs
  id TEXT PK (uuid) · session_key TEXT ('w3d2') · status TEXT ('completed'|'partial')
  started_at / ended_at TEXT · active_duration_s INT (excludes pauses)
  distance_m REAL · summary_polyline TEXT (encoded polyline, precision 5, for thumbnails/v2)
  healthkit_saved INT (bool) · created_at / updated_at / deleted_at

run_segments
  id TEXT PK · run_id FK · seq INT · kind TEXT ('warmup'|'run'|'walk'|'cooldown')
  planned_duration_s INT · actual_duration_s INT · distance_m REAL · was_skipped INT (bool)
  created_at / updated_at

run_points                        -- raw GPS, source of truth for the route
  run_id FK · seq INT · (run_id, seq) PK · timestamp TEXT
  lat REAL · lng REAL · altitude REAL · accuracy REAL · speed REAL · segment_seq INT

active_run_snapshot               -- single row: serialized engine state for crash recovery
  id INT PK CHECK(id=1) · state_json TEXT · updated_at TEXT
```

Sizing: ~1800 points per 30-min run ≈ 100–150 KB; 100 runs ≈ 15 MB. Negligible for SQLite and iCloud backup. `run_points` for finished runs may be compacted in the future; at C25K volumes it is not needed.

**Reactivity rules (research-driven):**
- `useLiveQuery` only on low-churn tables (`runs`, `run_segments` for a fixed `run_id`). **Never** on `run_points` — Drizzle re-runs the entire query on every insert (1/s during a run), and stacked router screens keep re-running live queries in the background.
- Drizzle's live query tracks only the query's **top-level table** (joins/nested tables don't trigger). Structure screen queries accordingly (query `runs`, fetch segments imperatively or with a second live query).
- One shared DB connection (`SQLiteProvider` + `enableChangeListener: true`); never `useNewConnection`.
- Known open bug: `useLiveQuery` may not notify when a result set becomes empty (drizzle-orm #2620) — avoid UI that depends on an emptying live result; derive "no runs" from counts where it matters.
- "Current session" is **derived** (first session in plan order without a completed run), never stored — free repeats need no special-casing.

**Migrations:** `drizzle-kit generate` with `driver: 'expo'` → `.sql` files + `migrations.js`; Metro `sourceExts.push('sql')`; `babel.config.js` with `babel-preset-expo` + `inline-import` for `.sql`. Applied at startup via `useMigrations` gate before the tab UI renders.

## 5. Run engine

A plain TypeScript singleton — no React, no platform imports. All platform effects (GPS, audio, DB) are injected ports, so the whole engine is unit-testable.

**States:** `idle → running(segmentIdx) ⇄ paused → completed | abandoned`
**Inputs:** `start(sessionKey)`, `pause()`, `resume()`, `skipSegment()`, `endEarly()`, `heartbeat(now, fix?)`

**Time is derived, never accumulated:**

```
activeElapsed(now) = now − startedAt − Σ(completed pause intervals) − (now − pausedAt if paused)
```

The session's segment timeline is a prefix-sum over planned durations, adjusted by skip events (a skip stamps the current segment's actual end = now, truncating it). Current segment = position of `activeElapsed` in the adjusted timeline. Because everything derives from a timestamped event log (start / pause / resume / skip), the engine is immune to JS timer drift, survives process death, and replays identically — the foundation for crash resume.

**Heartbeats:** while locked, the ~1 Hz background location events drive `heartbeat()` (research-verified: the JS runtime keeps executing on these events while `UIBackgroundModes: location` is active). In foreground a 1 s `setInterval` supplements for smooth UI. Cues fire on derived-segment *change*, so a late heartbeat speaks the cue late but never skips or double-fires it.

**Per heartbeat:** recompute segment → fire cue on change (incl. halfway/last-run milestones) → accept GPS fix if `accuracy ≤ 50 m` (append to in-memory track, add haversine delta to distance, tag with `segment_seq`) → every ~5 s batch-insert points + upsert `active_run_snapshot` in one transaction.

**Completion:** timeline exhausted → `completed`; write `runs` + `run_segments`, encode `summary_polyline`, clear snapshot, fire congratulations cue, `router.replace` to summary, then `HealthAdapter.saveRun()` (non-blocking). `endEarly()` → same flow with `status: 'partial'`.

**Crash recovery:** on app launch, an `active_run_snapshot` younger than (planned session length + 30 min) → "Resume run?" dialog; resume rebuilds the engine from the event log (elapsed stays correct because it's wall-clock math). Decline or older → finalized as `partial`.

## 6. Background execution, permissions, audio

**app.json (new pieces):**

```jsonc
{
  "ios": {
    "bundleIdentifier": "se.lukaslindqvist.myrunner"   // personal namespace, never se.bovra.*
  },
  "plugins": [
    ["expo-location", {
      "locationWhenInUsePermission": "Your location is used to map your route and measure distance during runs, including while your screen is locked.",
      "isIosBackgroundLocationEnabled": true            // adds UIBackgroundModes: location
    }],
    ["expo-audio", { "enableBackgroundPlayback": true }], // adds UIBackgroundModes: audio
    "expo-maps",
    ["@kingstinct/react-native-healthkit", {
      "NSHealthUpdateUsageDescription": "Save your completed runs (duration, distance, route) to Apple Health.",
      "background": false                                // write-only: no background delivery, no AppDelegate mod
    }],
    ["expo-build-properties", { "ios": { "deploymentTarget": "18.0" } }]
  ]
}
```

**Location:** `startLocationUpdatesAsync(LOCATION_TASK, { accuracy: BestForNavigation, activityType: Fitness, pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true, distanceInterval: 0 })` with the task defined at **module scope** and imported from the app entry. **When-In-Use permission only** — Apple permits background continuation for sessions started in the foreground (runs always are), Expo's task consumer enables it, and it avoids the "Always" prompt (user trust + App Review). iOS ignores `timeInterval`; the natural ~1 Hz GPS cadence is the heartbeat.

**Audio session** (configured at run start, released at end):

```ts
await setAudioModeAsync({
  playsInSilentMode: true,        // Playback category — silent switch can't mute cues
  shouldPlayInBackground: true,   // session survives lock
  interruptionMode: 'duckOthers', // Spotify dips, keeps playing, recovers
});
```

expo-speech speaks through this shared session by default (`usesApplicationAudioSession`). Known risk class: background TTS fade-out (expo #19407) and stuck ducking (#19042) — hence **Milestone 0** (§10) and the swappable `CueService`.

**Cue script (English, ~10 phrases):** warmup start · "Start running" · "Start walking" · halfway (at 50% of planned total session time) · last run segment · cooldown start · workout complete + congratulations · paused · resumed · (resume-from-crash) "Resuming your workout".

**App Review posture:** background modes `location` + `audio` are both legitimately used (run tracking, audible coaching cues — justified in Review Notes); specific purpose strings; minimal privacy nutrition label ("data not collected"); privacy policy URL required due to HealthKit.

## 7. Platform ports (iOS now, Android later)

Every platform-touching capability sits behind a small TS interface owned by `services/`; callers (engine, screens) import only the port. Adapter selection via platform file resolution (`.ios.ts` / `.android.ts`). `domain/` and `run-engine` stay 100% platform-free.

| Port | iOS adapter (v1) | Android adapter (later) |
|---|---|---|
| `HealthAdapter` — `isAvailable()`, `requestWriteAccess()`, `saveRun(run, segments, points)` | HealthKit via `@kingstinct/react-native-healthkit` | Health Connect via `react-native-health-connect` |
| `CueService` — `prepare()`, `announce(cue)`, `release()` | expo-speech over expo-audio session | same libs; Android audio-focus config isolated here |
| `LocationTracker` — `start()`, `stop()`, `onFix(cb)` | expo-location, When-In-Use + background indicator | same lib; foreground-service notification config isolated here |
| `RouteMap` (component port) | `AppleMaps.View` (expo-maps) | `GoogleMaps.View` (expo-maps; API key needed then) |
| `BackupAdapter` — v2, interface defined only | (future) iCloud file sync | (future) Google Drive — `react-native-cloud-storage` covers both |

expo-location / expo-speech / expo-audio / expo-maps are already cross-platform, so most Android adapters are config variants, not rewrites. HealthKit is the only iOS-only library and is fully boxed.

## 8. Navigation & screens

**Unified navigation rule (user decision):** every modal surface — full-screen modals, bottom sheets/cards, form sheets — is an **expo-router screen** with a native `presentation` option in the root Stack. No component-level sheet/modal libraries for navigation surfaces (`@expo/ui` BottomSheet is not used). Native feel first; leave native elements only when a need is demonstrated.

```
src/app/
├── _layout.tsx               # root Stack: SQLiteProvider → migrations gate → resume-run check
├── (tabs)/
│   ├── _layout.tsx           # NativeTabs: Plan · History · Settings (SF Symbols)
│   ├── index.tsx             # Plan (home)
│   ├── history.tsx           # History
│   └── settings.tsx          # Settings
├── onboarding/               # versioned first-launch flow — fullScreenModal; step routes (welcome, audio, location, health)
├── session/[key].tsx         # pre-run detail — presentation: 'formSheet' (native detents, grabber)
├── run.tsx                   # active run — presentation: 'fullScreenModal', gestureEnabled: false
├── run-summary.tsx           # post-run — router.replace target from run.tsx (back never returns to a finished run)
└── runs/[runId].tsx          # run detail — standard push (named /runs/… to avoid colliding with the /history tab route)
```

Per-screen (SwiftUI = `@expo/ui` inside a `Host`; research-verified stable in SDK 57):

- **Plan (home)** — full SwiftUI: `List` with a `Section` per week, rows with completion checkmarks (`Image systemName`), `Gauge`/`ProgressView` per-week progress, badge on next session, `ContentUnavailableView` empty state. Tap → `session/[key]` form sheet.
- **Pre-run detail (form sheet)** — SwiftUI: segment bar (HStack of rounded rectangles, width ∝ duration, colored by kind), session stats (`LabeledContent`), previous attempts for this session, big glass **Start** button → `router.push('/run')`.
- **Active run (full-screen modal)** — hybrid: JS engine drives, SwiftUI presents. Big countdown `Text` (`monospacedDigit` + `contentTransition` rolling digits), current segment name + color, "Next: Run 3 min" preview, `Gauge` segment progress, elapsed/distance row, glass Pause/Skip buttons, End with confirmation dialog. **Screen-awake toggle** on the run screen (persisted setting, default on): keeps the display awake for the whole run via `useKeepAwake()`, so the app stays glanceable and — because the app then stays foreground — a **haptic cue accent channel** stays viable alongside audio (haptics cannot fire from a backgrounded app; ADR 0009). Toggle off = normal auto-lock for pocket runners; audio cues continue via the background location heartbeat (ADR 0008). **No live map in v1** (glanceability + battery; route appears at summary).
- **Run summary** — congratulations header, SwiftUI `Form`/`LabeledContent` stats (duration, distance, avg pace, per-segment table), **RouteMap** (RN island): one expo-maps polyline per segment — run segments in the accent color, walk/warmup/cooldown in a muted color — plus start/finish markers, camera fitted to route. Apple Health save status row. Done → dismiss to Plan.
- **History** — SwiftUI `List` grouped by week: session key, date, distance, duration, partial badge; swipe-to-delete (soft delete). No per-row map thumbnails in v1 (embedding RN views per SwiftUI row is the documented anti-pattern; revisit with `summary_polyline` + react-native-svg in an RN list if wanted later).
- **Run detail** — RouteMap with segment-colored route + SwiftUI splits list (per segment: planned/actual time, distance, pace) + "Save to Apple Health" retry if unsaved.
- **Settings** — SwiftUI `Form`: cue toggles (all cues / milestone cues), Apple Health toggle (triggers authorization), About, Reset all data (destructive confirm via native alert).

**Theming:** the repo's styling system is Uniwind (Tailwind v4 for RN) — RN shells style with `className` tokens from `src/global.css`, via the `className`-based `ThemedText`/`ThemedView` wrappers. SwiftUI trees can't consume Tailwind classes, so they bridge through the JS palette mirror in `src/constants/theme.ts` (`Colors`) via `Host seedColor` + `foregroundColor`/`background` modifiers — one more reason that mirror must stay in sync with `global.css`. One visual system per block — never alternate RN and SwiftUI text within the same cluster.

## 9. HealthKit integration (behind `HealthAdapter`)

- Library: `@kingstinct/react-native-healthkit` v14 (Nitro/New-Arch, active, config plugin). Write-only: `requestAuthorization({ toShare: [workout, workoutRoute, distanceWalkingRunning, activeEnergyBurned] })`.
- On run completion (and via retry affordance): `saveWorkoutSample(WorkoutActivityType.running, quantities, start, end, { distance })` → `proxy.saveWorkoutRoute(locations)` (HKWorkoutRouteBuilder under the hood — full GPS route appears in Apple Health).
- **Limitation (verified in library source):** workout pause/segment *events* are not writable (`workoutEvents: nil` hardcoded). Workaround: attach per-interval `DistanceWalkingRunning` quantity samples; our DB remains the source of truth for the interval structure.
- Failure handling: run is already saved locally before any Health call; `healthkit_saved` flag + retry on run detail; denial is respected silently (toggle stays off).
- App Review 5.1.3: write only real measured values; do not mirror HealthKit-sourced data into any future iCloud sync payload (our data is app-generated workout logs, which is fine).

## 10. Testing & verification

- **Unit (`bun test`):** `domain/` + run engine are pure TS: segment derivation (incl. pause/skip/resume edge cases), elapsed math, accuracy filtering + haversine, polyline encoding, plan-data integrity (27 sessions; per-session durations sum to spec; W6R3 = 25 min NHS).
- **Milestone 0 — device spike (go/no-go before building screens):** minimal dev-client build → TestFlight/release configuration on a physical iPhone: locked-phone GPS continuity for 30+ min, TTS audibility while locked, Spotify ducking + recovery, silent switch, Bluetooth headphones, phone-call interruption. Background behavior is untestable in Expo Go and misleading in simulators — this validates the riskiest assumptions first. Failure of TTS-while-locked → switch `CueService` to pre-recorded files (decision pre-made).
- **E2E (every stage, not an end-phase):** Maestro CLI + MCP are already configured in the repo (ADR 0001, `.mcp.json`); Stage 1 contributes the first `.maestro/` flows and stable `testID`s. EAS `maestro` job as CI gate later. Automatable session flows depend on the **dev-only compressed plan** (same session structure, seconds-long segments, behind a `__DEV__`/launch-argument switch — part of `domain/plan.ts`'s contract, also useful for demos). Each stage ships flows for its new surface and its exit criteria include "stage flows pass" (§13).
- **Manual checklist:** location permission denied path, kill-mid-run resume, HealthKit deny + retry, week-9 completion celebration, partial-run display.

## 11. Error handling

| Failure | Behavior |
|---|---|
| Location permission denied | Session fully works (timer + cues); no distance/route; banner links to iOS Settings |
| GPS loss / accuracy > 50 m | Timer and cues unaffected; track gap; summary marks distance approximate |
| Audio/TTS failure | Non-fatal: cue skipped, screen still shows transition; console log only (no analytics by design) |
| Phone call | iOS pauses app audio; engine unaffected; cues resume after call |
| Health save fails/denied | Local save already done; flag + retry affordance; never blocks completion |
| App killed mid-run | Snapshot-based "Resume run?" (§5) |
| DB batch failure | Points retained in memory, retried next batch |

## 12. Accepted risks & fallbacks

1. **expo-maps alpha + iOS 18.0 floor** — accepted (2026 v1; hardware floor same as iOS 17). Version pinned; **react-native-maps pre-approved fallback** (small migration: both take coordinate arrays + color/width; also restores older-iOS support and adds snapshots).
2. **TTS while locked** — Milestone 0 spike; pre-recorded files behind `CueService` as drop-in fallback.
3. **Drizzle `useLiveQuery` quirks** — top-level-table tracking + empty-result bug; mitigated by reactivity rules (§4).
4. **HealthKit lib open issues on iOS 26.x betas** — pinned version; saves wrapped and non-blocking; feature degrades gracefully.
5. **expo-router formSheet behaviors** vary by iOS version — validate detents/grabber on device early; falling back to `presentation: 'modal'` is acceptable.

## 13. Delivery stages (v1 roadmap)

V1 ships in **five incremental stages. Each stage is a working, usable app** — every stage ends starter-code-free with the ports-respecting architecture intact, and each new platform surface (audio, location, maps, Health) enters only through its port. A separate implementation plan will be written per stage; no implementation accompanies this spec.

**Ordering constraint:** background execution rides on GPS — the ~1 Hz location events are what keep the JS engine alive while the phone is locked (§6). Spoken cues therefore arrive first in foreground form (Stage 2), and locked-phone operation arrives together with location tracking (Stage 3).

**Onboarding is a Stage-1 foundation, not a stage:** a versioned first-launch flow (`onboarding/` routes; `completed_steps` in kv-store). Steps are versioned by id, so an update that introduces a new permission shows only the pending step ("One more thing…") to existing users. Every permission follows the **gracious-ask pattern**: a primer screen in plain language (why + what you get) → the system prompt; "Not now" always available; denial respected — the feature degrades gracefully and Settings deep-links let the user change their mind. Never a cold system prompt.

### Stage 1 — Interval-timer MVP (+ architecture reset)

*You can complete the entire 9-week program, phone in hand.*

- Architecture reset: delete create-expo-app starter screens/components; establish the layered structure (§3) with `@/*` aliases; `bun test` from day one.
- NHS plan seed data (27 sessions) + compressed dev plan + plan-integrity unit tests.
- Data layer: expo-sqlite + Drizzle, migrations pipeline, `runs` + `run_segments`, kv-store settings.
- Run engine v1: full timestamp state machine (start/pause/resume/skip/end-early), foreground `setInterval` heartbeat — the GPS heartbeat slots in later without engine changes.
- Screens: NativeTabs (Plan / History / Settings shells), Plan tab with progression + free repeat, pre-run form sheet, full-screen-modal run screen (countdown, current/next segment, controls, `useKeepAwake`), basic run summary, basic History list.
- Onboarding: framework + steps — welcome, how C25K works, gentle "check with a doctor if unsure" note. No system permissions (the MVP needs none).
- E2E foundation: first `.maestro/` flows (CLI + MCP already configured, ADR 0001) + stable `testID`s — onboarding → plan browse → start → compressed session completes → History row; pause/skip/end-early variants; progression advances.
- **Deliberately absent:** sound, GPS, distance, maps, Health, crash resume.
- **Works when:** a full session runs screen-on with correct transitions and lands in History; progression advances; stage flows pass.

### Stage 2 — Spoken coach (foreground)

*The app coaches you audibly — screen on or phone unlocked in a holder.*

- `CueService` port + TTS adapter: expo-audio session (`playsInSilentMode`, `duckOthers`) + expo-speech; full ~10-phrase cue script wired to engine transitions and milestones.
- Settings become real: all-cues / milestone-cues toggles.
- Onboarding: audio-cues intro step (no iOS permission required; explains cues + silent-switch behavior, sets preference).
- Device verification (foreground): silent switch, Spotify dip-and-recover, Bluetooth headphones.
- E2E: cue settings toggles; visual transition assertions during a compressed session. (Audio itself is not E2E-assertable — device checklist.)
- **Deliberately absent:** locked-screen operation (honest limitation: cues stop if you lock — Stage 3 fixes this).
- **Works when:** a session runs end-to-end with correct spoken cues over playing music; stage flows pass.

### Stage 3 — GPS tracking + locked-phone operation (the risk stage)

*Phone goes in the pocket: full tracking + cues while locked — paid-app parity.*

- **Gate: Milestone-0 device spike first** — locked-phone GPS continuity + TTS audibility in a release build (§10). Fallback pre-decided: pre-recorded cue files behind `CueService`.
- expo-location + task-manager: When-In-Use permission, `UIBackgroundModes: [location, audio]`, module-scope task; engine heartbeat switches to location events when backgrounded.
- Distance: accuracy filter + haversine (`domain/geo.ts`), `run_points` batching, per-segment distance/pace — live, in summary, in History.
- Crash resume: `active_run_snapshot` + "Resume run?" flow.
- Onboarding: location primer step → When-In-Use system prompt; also asked just-in-time at first run start if skipped. Denied → timer-only sessions keep working.
- E2E: permission primer allow/deny paths (Maestro `launchApp` permission stubs + `setLocation`); denied-path session completes; resume-after-kill flow. Real locked-phone behavior remains the physical-device gate.
- **Deliberately absent:** map rendering.
- **Works when:** a real 30-min outdoor run, phone locked, Spotify playing → correct cues, correct route data, correct distance; stage flows pass.

### Stage 4 — Maps

*Runs become visible: routes on Apple Maps.*

- iOS deployment target → 18.0 (`expo-build-properties`); expo-maps pinned; `RouteMap` component port (react-native-maps fallback stays pre-approved).
- Run summary upgraded: segment-colored polylines, start/finish markers, camera fit.
- Run detail screen (`runs/[runId]`): map + per-segment splits table.
- Onboarding: no new permissions.
- E2E: run detail opens; map + splits render for a seeded run. (Polyline pixel-correctness is a visual check.)
- **Works when:** completed runs show correctly colored routes and splits from real recorded data; stage flows pass.

### Stage 5 — Apple Health + release polish

*V1 complete: ecosystem integration and App Store readiness.*

- `HealthAdapter` + `@kingstinct/react-native-healthkit`: write-only auth, workout + GPS route save, `healthkit_saved` flag + retry, Settings toggle.
- Onboarding: Apple Health opt-in step (explicitly skippable).
- Polish: glass effects/animations where they earn it, empty states, week-9 graduation celebration, app icon/splash, purpose strings + privacy policy, App Review notes (background-modes justification).
- E2E: Health opt-in allow/skip paths; full regression suite consolidated as the release gate. (HealthKit save verified manually in the Health app.)
- **Works when:** a TestFlight build passes the full manual checklist; a run lands in Apple Health with its route map; regression suite green.

## 14. Out of scope for v1 (designed-for, not built)

Live Activity / Dynamic Island (official `expo-widgets`; engine already event-driven so `update()` on segment change is a bolt-on) · explicit iCloud/Drive sync (`BackupAdapter` port + sync-agnostic schema ready) · data export (GPX/JSON) · Android (ports defined, adapters pending) · Apple Watch · aggregate stats dashboards · localization (strings centralized from day one) · auto-pause · distance-based session variants · post-C25K programs.

## Appendix A — NHS C25K plan data (27 sessions)

Every session: 5-min brisk warmup walk + intervals + 5-min cooldown walk. All three sessions in a week are identical except weeks 5 and 6.

| Week | Intervals (between warmup/cooldown) | Run total |
|---|---|---|
| 1 | 8 × (60 s run + 90 s walk), ends on a run (7 walks) | 8 min |
| 2 | 6 × (90 s run + 2 min walk), ends on a run (5 walks) | 9 min |
| 3 | 2 × (90 s run, 90 s walk, 3 min run, 3 min walk) | 9 min |
| 4 | 3 min run, 90 s walk, 5 min run, 2½ min walk, 3 min run, 90 s walk, 5 min run | 16 min |
| 5 D1 | 5 run, 3 walk, 5 run, 3 walk, 5 run (min) | 15 min |
| 5 D2 | 8 run, 5 walk, 8 run (min) | 16 min |
| 5 D3 | **20 min continuous run** | 20 min |
| 6 D1 | 5 run, 3 walk, 8 run, 3 walk, 5 run (min) | 18 min |
| 6 D2 | 10 run, 3 walk, 10 run (min) | 20 min |
| 6 D3 | **25 min continuous run** (NHS; original was 22) | 25 min |
| 7 | 25 min continuous ×3 | 25 min |
| 8 | 28 min continuous ×3 | 28 min |
| 9 | 30 min continuous ×3 — D3 = graduation 🎉 | 30 min |

Encoding: `{ key: 'w1d1', week, day, segments: [{kind, seconds}, …] }` including warmup/cooldown as segments.

## Appendix B — key research sources

- expo-sqlite: docs.expo.dev/versions/v57.0.0/sdk/sqlite · Drizzle expo driver + `useLiveQuery` source (drizzle-orm/src/expo-sqlite/query.ts) · open bug drizzle-orm#2620
- Backup semantics: Apple File System Programming Guide (Documents backed up); expo-sqlite default dir verified in SQLiteModule.swift (sdk-57)
- expo-location background: docs.expo.dev/versions/v57.0.0/sdk/location · When-In-Use continuation: expo PR #12594, issue #15066 · RN background timers: RCTTiming.mm, RN issue #38711
- expo-speech/audio: docs.expo.dev/versions/v57.0.0/sdk/speech, /sdk/audio · background TTS fade-out expo#19407 · ducking issues #19042, #34902
- expo-maps SDK 57: docs.expo.dev/versions/v57.0.0/sdk/maps · AppleMaps.types.ts (polylines, per-polyline color/width) · polyline support PR expo#36236 · iOS 18.0 min per sdk-57 README
- @expo/ui: stable per expo.dev/blog/expo-ui-stable-sdk-56 · component/modifier inventory verified against installed node_modules v57.0.4 · guides/expo-ui-swift-ui
- HealthKit: kingstinct/react-native-healthkit v14 source (WorkoutsModule.nitro.ts, WorkoutProxy.swift, app.plugin.ts) · App Review Guidelines 5.1.3
- C25K program: NHS Couch-to-5K plan (nhs.uk) · original Cool Running plan PDF
