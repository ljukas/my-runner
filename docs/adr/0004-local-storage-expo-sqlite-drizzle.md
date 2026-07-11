# 4. Local storage: expo-sqlite + Drizzle ORM with a sync-agnostic schema

Date: 2026-07-11

## Status

Accepted

## Context

All data lives on-device (no backend, no accounts); iCloud **device backup**
is the v1 safety net, so the database file must live somewhere iOS backs up.
The data itself (C25K design spec §4) is small and write-shaped: `runs` and
`run_segments` written once per finished session, `run_points` appended in
batches (~1 GPS point/second during a run, ~1800 points per session, ~15 MB at
100 runs), a single-row crash snapshot, and settings.

Forces on the choice:

- Plan and History screens should refresh automatically when a run finishes;
  the active-run screen must **not** re-render per GPS point.
- Schema will evolve across the five delivery stages — migrations must be
  first-class, not hand-rolled.
- Project policy prefers official/vendor tooling over community wrappers.
- No sync mechanism is chosen for v2+, but the schema should not foreclose one.

Research findings this decision rests on (verified 2026-07-11):

- expo-sqlite's default database directory on iOS is **`Documents/SQLite`**
  (verified in `SQLiteModule.swift`, sdk-57 branch) — inside the app's
  Documents container, which iOS device backups include automatically.
- Drizzle's `useLiveQuery` (verified in `drizzle-orm/src/expo-sqlite/query.ts`)
  subscribes via `addDatabaseChangeListener` and tracks **only the query's
  top-level table** — joined/nested tables never trigger re-runs, subqueries
  and raw SQL are rejected — and it re-runs the whole query on **every**
  change to that table, regardless of which rows changed.
- drizzle-orm [#2620](https://github.com/drizzle-team/drizzle-orm/issues/2620)
  (`useLiveQuery` does not notify when a result set becomes empty) has been
  **open since July 2024** with no fix or workaround — it must be designed
  around, not waited out.
- `expo-sqlite/kv-store` is an official drop-in replacement for AsyncStorage
  (same engine, sync + async APIs).
- The Expo docs recommend enabling WAL journal mode explicitly — it is not the
  default.
- Current versions at decision time: `expo-sqlite` 57.0.0, `drizzle-orm`
  0.45.2, `drizzle-kit` 0.31.10.

## Decision

**expo-sqlite is the storage engine, with Drizzle ORM on top.** The DB stores
only results; the training plan remains static TypeScript data (spec §3).

1. **One connection.** The database is opened once via `SQLiteProvider` with
   `enableChangeListener: true`; WAL journal mode is enabled at open. Never
   `useNewConnection`.

   *Implementation note (Stage 1):* the single connection is a module-scope
   singleton in `src/db/client.ts` (`openDatabaseSync` + `drizzle()`), not
   `SQLiteProvider` — the run engine's persistence adapter needs the DB
   outside the React tree. All other guarantees of this point stand.
2. **Typed schema + generated migrations.** Schema lives in `src/db/schema.ts`;
   `drizzle-kit generate` with `dialect: 'sqlite'`, `driver: 'expo'` produces
   `.sql` files plus `migrations.js` (committed). Pipeline requirements:
   `babel.config.js` with `babel-preset-expo` + `babel-plugin-inline-import`
   for `.sql`, and `config.resolver.sourceExts.push('sql')` in
   `metro.config.js` (inside `withUniwindConfig`, which stays outermost).
   Migrations apply at startup via a `useMigrations` gate before the tab UI
   renders.
3. **Reactivity rules** (binding, derived from the verified driver behavior):
   - `useLiveQuery` only on low-churn tables: `runs`, and `run_segments`
     filtered to a fixed `run_id`.
   - **Never** on `run_points` — a live query there re-runs once per second
     for an entire run, on every stacked router screen that mounts it.
   - Structure screen queries around the top-level table: live-query `runs`,
     fetch related segments imperatively or with a second live query. Joins
     do not trigger updates.
   - No UI may depend on a live result set *becoming empty* (#2620); derive
     "no runs" from counts or explicit refetch where it matters.
   - The active-run screen reads engine state via `useSyncExternalStore`,
     never the DB.
4. **Settings and onboarding progress** live in `expo-sqlite/kv-store` — no
   AsyncStorage or MMKV dependency.
5. **Sync-agnostic schema rules** (every table): TEXT UUID v4 primary keys
   (`expo-crypto`), `created_at`/`updated_at` as ISO-8601 UTC strings set by
   app code, soft delete via `deleted_at` on user-mutable tables. No sync
   mechanism is chosen; these columns keep a future diff/merge layer possible
   without a schema migration.
6. **No state library.** Live queries plus the engine's external store cover
   app state (settings via kv-store).

## Consequences

- The database sits in `Documents/SQLite`, so iCloud device backup covers it
  with zero code — the v1 backup story is free. (WAL sidecar files live there
  too; harmless.)
- Typed rows, generated migrations, and reactive Plan/History screens out of
  the box.
- The reactivity rules are **load-bearing**: `useLiveQuery`'s coarse tracking
  means violating them produces 1 Hz re-render bugs, not subtle slowdowns.
  They belong in review checklists until a lint rule exists.
- Soft delete means History's swipe-to-delete is an `UPDATE`; all user-facing
  queries filter `deleted_at IS NULL` (worth a shared query helper).
- The sync-agnostic columns cost a few bytes per row and do **not** buy
  conflict-free sync (no vector clocks, no CRDTs) — they only avoid
  foreclosing options. That is the intent; building sync machinery now would
  be speculative.
- Drizzle's expo driver is the least mature part of the stack (#2620 open for
  two years). The blast radius is contained: it affects live-query UX only,
  never data integrity, and dropping to `useSQLiteContext()` + manual
  refetch is a screen-local fallback that needs no schema or engine changes.
- drizzle-kit runs at dev time only (`bunx drizzle-kit generate`); nothing
  ORM-related executes natively, so CNG is untouched.

## Alternatives considered

- **Raw expo-sqlite, no ORM** — rejected: hand-rolled migrations and untyped
  rows for a schema that evolves across five stages, plus we would rebuild
  change-listener reactivity that Drizzle already ships.
- **op-sqlite (+ Drizzle driver)** — the high-performance community JSI
  SQLite. Rejected: community-maintained (against the official-tooling
  policy), and its performance edge is irrelevant at ~1 insert/second with
  5-second batches. expo-sqlite is the official, CNG-native path with the
  verified backup location.
- **WatermelonDB** — reactive DB built around its own model/decorator layer
  and a sync protocol that assumes a backend. Oversized buy-in for a
  no-backend app.
- **TinyBase** — reactive in-memory store with SQLite persisters; a different
  paradigm that would put the relational queries (per-segment splits, per-run
  points) furthest from SQL.
- **LiveStore** — event-sourcing/sync platform; solves problems this app has
  explicitly deferred.
- **AsyncStorage or MMKV for settings** — rejected: `expo-sqlite/kv-store` is
  an official drop-in on the engine we already ship, so a second storage
  dependency buys nothing.
