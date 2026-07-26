# 23. Completion is a projection over two sources — recorded runs ∪ manual marks; week-focus is a pure view of it

> **Scope note.** The completion model below (a table, a pure union projection, the
> sequencing it feeds) is platform-neutral TypeScript + SQLite. Only the *surface
> affordances* — swipe/long-press to mark done, collapsible week groups — are iOS-only
> today ([ADR 0020](0020-ios-only-android-deferred.md)); a future Android pass re-skins the
> surface without touching the seam.

Date: 2026-07-26

## Status

Proposed — draft for review. Flip to `Accepted` on merge.

## Context

Two Plan-screen features were requested, and the project owner was explicit that they are
**distinct**:

1. **Week focus** — a *completed* week grays out and moves to the end of the Plan list (and
   collapses to reclaim space), so the next week to run stays in focus.
2. **Manual completion** — the user can mark individual days (or a whole week) as completed
   *without* running them in-app, for someone migrating mid-program from another app. This
   must feed feature 1: mark a whole week done and it grays/moves like any completed week.

The owner also fixed the load-bearing interaction: **"next up" must respect manual
completion** — after marking week 1 and half of week 2, the app must offer the first
genuinely-unfinished session, not re-offer a marked one.

Feasibility and local-first were established first; evidence and citations are in
[`docs/superpowers/research/2026-07-22-plan-week-focus-visibility.md`](../superpowers/research/2026-07-22-plan-week-focus-visibility.md)
(verdict: `Feasible-with-caveats`, `Fully local`). The findings that constrain *this*
decision are about the shape of the existing completion model, not the UI:

- **Completion already flows through one abstract set.** `nextSessionKey(plan,
  completedKeys)` (`src/domain/plan.ts`) is a pure function — *"first session in plan order
  without a completed run"* — over a `ReadonlySet<string>` of session keys. It does not know
  or care where that set comes from. The Plan screen
  (`src/app/(tabs)/(index)/index.tsx`) assembles the set **inline** today:
  `new Set(completedRuns.map(r => r.sessionKey))`, and separately re-derives per-week
  `done/total`. So "what counts as done" is defined in two places at once — the
  `runCompleted` query and the screen's inline Set-build.
- **"Completed" has exactly one definition today, and it means a Run.**
  `runCompleted = status='completed' AND deleted_at IS NULL` (`src/db/queries.ts`) — *"the
  one definition of a run that counts as completed."* A **Run** is, per `CONTEXT.md`, *"one
  recorded attempt at a session"* — it carries `started_at`/`ended_at`, `active_duration_s`,
  segments, distance, an optional polyline, a HealthKit flag ([ADR 0011](0011-apple-health-kingstinct-healthkit.md)).
  A *manual mark* has none of that: no attempt, no time, no segments.
- **Storage is sync-agnostic and soft-deletes.** [ADR 0004](0004-local-storage-expo-sqlite-drizzle.md)
  puts training data in expo-sqlite + Drizzle, soft-deleted via `deleted_at`, backed up by
  iCloud device backup; **preferences** (settings, onboarding) live in the separate
  `expo-sqlite/kv-store` `StringStorage` seam (`src/services/storage.ts`) behind a
  `create*Store` + `use*` hook. The run-save path is the `RunPersistence` port
  (`src/services/run-engine/types.ts` → `src/db/save-run.ts`), an [ADR 0007](0007-run-engine-event-log.md)/
  ADR 0004 seam.
- **The surface is @expo/ui islands.** The Plan list is a SwiftUI `List`/`Section` island
  ([ADR 0005](0005-system-native-ui-expo-ui.md)); screens compose only, new idioms wrap
  into `island/`/`ui/` ([ADR 0013](0013-component-design-conventions.md)); selectors are
  text-first ([ADR 0016](0016-text-first-maestro-selectors.md)). The research doc verified
  (against installed `@expo/ui@57.0.7` + official docs) that `DisclosureGroup`/`sidebar`
  `Section` collapse, `SwipeActions`, and `ContextMenu` all exist — the affordances are not
  in question here; the *data model* behind them is.
- **`AGENTS.md` hard constraints:** no backend/accounts/analytics; on-device + iCloud;
  iOS-primary.

The architectural question is therefore narrow and specific: **now that a session can be
"done" by a recorded run *or* by a manual mark, how is that represented, and where does the
union live** — so that `nextSessionKey`, week-focus, and any future "done" consumer all
agree, without smearing the definition across screens and queries.

## Decision

**Make *Completion* a named, pure projection that unions two sources — completed Runs and
manual completion marks — into the one `completedSessionKeys` set that sequencing and the
week-focus view already consume. Persist manual marks as their own training data (a
`session_completions` table), never as synthetic Runs. Keep week-focus a pure view over the
completion set, and persist only the collapse/expand ("group closing") state as a
kv-store preference.** Accepted to fix the shape; built when the feature ships.

1. **The seam — a Completion projection.** Introduce one pure function,
   `completedSessionKeys(sources) → ReadonlySet<string>`, that unions (a) the session keys
   of completed, non-deleted Runs (the existing `runCompleted` result) and (b) the session
   keys carrying a manual mark. **Every** consumer of "is this session done?" reads this set
   — `nextSessionKey`, week-focus, history badges, future stats — and none reads `runs`
   directly for completion. This *concentrates* the definition that is currently split
   between `runCompleted` and the screen's inline Set-build.
   - **The pure sequencing is unchanged.** `nextSessionKey`'s signature stays
     `(plan, ReadonlySet<string>)`; it already consumes the abstraction, so its logic **and
     its tests survive verbatim** — the union is added *upstream* of it. This is the
     signal the seam was already latent in the code; the ADR only names it and adds a
     source. *The interface is the test surface.*
   - **Next-up respects manual marks by construction.** Because marks land in the same set,
     marking week 1 + half of week 2 advances "next up" to the first genuinely-unfinished
     session with **no** change to sequencing — the owner's load-bearing requirement falls
     out of the union, not out of special-case code.

2. **Manual marks are their own data, not fake Runs.** Persist a manual completion in a new
   Drizzle table `session_completions` — roughly `{ session_key, marked_at, created_at,
   updated_at, deleted_at }` — following [ADR 0004](0004-local-storage-expo-sqlite-drizzle.md)'s
   sync-agnostic + soft-delete convention (un-marking soft-deletes, so a two-device iCloud
   merge resolves last-write-wins on `updated_at`). Generate the migration with
   `bun run db:generate`. **Not** a synthetic `runs` row:
   - *Deletion test / the Run concept.* A Run is a recorded *attempt* (`CONTEXT.md`);
     a mark is not. Representing a mark as a Run forces **every** runs-reading query — Log
     (`src/app/(tabs)/log`), run-summary, any distance/time stat, HealthKit — to grow an
     "exclude manual rows" special case. That *scatters* complexity outward: shallow and
     leaky. A separate source keeps `runs` pristine and keeps the union in one projection.
   - *Data, not preference.* A mark is per-session training-progress that must survive and
     iCloud-sync like a Run, so it belongs in the DB (ADR 0004), not the kv-store preference
     seam. (Contrast §4.)
   - The mark is the boolean fact only. It writes **no** HealthKit sample and contributes
     **no** distance/duration — those remain Run-only. A future "sessions completed" streak
     reads the completion projection; distance/time stats keep reading `runs`. That split is
     the seam boundary, stated so it isn't blurred later.

3. **Week-focus (feature 1) is a pure view projection — no new data.** A pure function over
   `(plan, completedSessionKeys)` yields the ordered, annotated weeks: per week its
   sessions, `done/total`, `isComplete`, and display order (complete weeks sorted to the
   end; grayed; collapsed-by-default). The screen composes it; the ordering/graying/collapse
   logic leaves the JSX body and becomes `bun test`-able in `domain/` like the rest of the
   plan logic. Feature 1 depends only on the *existence* of the completion set — it ships
   and is valuable even if manual marking (§2) never does; that is why the owner separated
   them, and the design keeps them decoupled.

4. **Collapse/expand state is a preference, in kv-store.** The "group closing" state — which
   completed weeks are collapsed vs expanded, which the owner requires to **persist across
   app sessions** — is UI/preference state, so it persists through the existing
   `expo-sqlite/kv-store` `StringStorage` seam (a small `plan-view` store with a `create*Store`
   + `use*` hook, the settings/onboarding precedent), **not** the DB. The auto rule "a
   fully-complete week collapses by default" merely *seeds* a week's state the first time it
   completes; once the user toggles a group, the stored value wins on later launches.

5. **The surface (iOS, deferred to the build + a spike).** Marking done is a `SwipeActions`
   action or a `ContextMenu` on a day row and on a week header (a week = mark its three
   days); un-marking mirrors it. Collapsing uses `DisclosureGroup` (research-doc front-runner
   — keeps the current inset-grouped look) or `sidebar` `Section`; the pick is the research
   doc's on-device spike, **not** this ADR. New idioms wrap into `island/`/`ui/`
   ([ADR 0013](0013-component-design-conventions.md)); no raw RN `Text`/`Pressable` in the
   screen; text-first Maestro selectors ([ADR 0016](0016-text-first-maestro-selectors.md))
   grow anchors for the new rows.

## Consequences

- **One definition of "done," many projections.** After this, `completedSessionKeys` is the
  sole answer to "is this session complete?"; the Plan screen's inline Set-build disappears,
  and `nextSessionKey` + week-focus + any future consumer can't drift apart. High leverage
  for a tiny surface — the deepening the deletion test predicts.
- **The interface is the test surface (ADR 0007 §7 posture).** `nextSessionKey` tests are
  untouched; new pure tests cover the union projection and the week-focus view with no RN
  runtime; the manual-mark persistence gets a fake in tests (the `fakeStorage()` pattern),
  the Drizzle write gets device-level verification, not SDK-internal mocks.
- **One migration, no native change.** Adds the `session_completions` table (+ generated
  migration) and pure `domain/` code only — no new dependency, no config plugin, no
  `@expo/fingerprint` change, so it can ship as an **OTA** update
  ([ADR 0012](0012-release-please-fingerprint-gated-releases.md)), unlike the native-SDK
  ports.
- **Fully local-first preserved.** Marks are on-device rows riding iCloud device backup like
  runs; no backend, no account, no analytics (`AGENTS.md` holds).
- **Two features, two independent ships.** Week-focus (§3) can land first over the current
  runs-only completion set; manual marking (§2) adds the second source later. Neither blocks
  the other.
- **Stats/HealthKit boundary is now explicit** (§2): a mark advances *completion* only. Any
  code that treats "completed" as "ran" must be checked against the projection-vs-`runs`
  split when stats land.
- **E2E + selectors grow**, and the icon-only `plan-next-*` escape hatch plus new
  mark/collapse rows need anchors (ADR 0016).
- **Cost:** a table + a projection + a view function + a kv-store store to keep honest — but
  each is small, pure where it can be, and none imports a platform SDK into the view layer.

## Alternatives considered

- **Synthetic manual `runs` rows (add a `source: 'tracked' | 'manual'` column).** Rejected
  by the deletion test and the Run concept: it needs zero change to `nextSessionKey`, but a
  mark is not an *attempt*, so every runs-reading query (Log, summary, distance/time stats,
  HealthKit) must special-case "exclude manual" — scattering the special case is the
  opposite of the intended deepening. The union projection buys the same "next-up just
  works" with none of the leak.
- **A single `completions` table as the sole source of truth** (finishing a run also writes
  a completion; `completedSessionKeys` reads only completions). Rejected as over-built: it
  changes the [ADR 0007](0007-run-engine-event-log.md) run-save path, denormalizes
  "completed run ⇒ completed" into a second row that can drift (it must be revoked when a run
  is soft-deleted), and adds moving parts the need doesn't justify. Unioning at read time
  gets the identical set with less coupling and no write-path change.
- **Manual marks in kv-store instead of the DB.** Rejected: marks are per-session
  training-progress *data* that must sync and soft-delete like runs, which is exactly what
  the DB (ADR 0004) provides; kv-store is the *preference* seam. The split is principled —
  the collapse/expand state (a genuine preference) *does* go to kv-store (§4), and the two
  concerns divide on that axis.
- **Derive collapse state only (don't persist it).** Rejected by explicit owner requirement:
  the closing of groups must survive restarts (§4).
- **One combined "hide/visibility" feature** (the earlier research framing). Superseded: the
  owner reframed it as completion with two sources, which dissolves the "hide vs next-up"
  tension the research doc flagged — a marked-done week is genuinely done, so next-up and
  week-focus both respect it without a separate visibility flag.
- **Do nothing — keep completion = runs only.** Viable; this ADR fixes *how* the two
  features are built if built, not *that* they must be. But the migration case the owner
  raised cannot be served without a second completion source.
