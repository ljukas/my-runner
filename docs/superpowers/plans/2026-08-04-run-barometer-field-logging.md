# Barometer field-logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture barometer readings and full run diagnostics during real runs, and export one run's complete data to a text file, so the elevation reducer's tuning can be chosen from measurement instead of guesswork.

**Architecture:** The run engine owns the barometer stream and hands readings to `RunStore.flush`, so they land in the same transaction as `run_points` (spec §3.1). Barometer readings get a typed table because the render slice consumes them as product data; everything else goes to one generic append-only `run_log` whose `kind` column is plain text, so a future signal needs no migration. A pure `domain/run-export.ts` serializes a run to a sectioned text file; a thin service writes it and opens the share sheet. Captures are taken in a field-test mode whose unclaimed `sessionKey` keeps them out of the training record.

**Tech Stack:** Expo SDK 57, React Native 0.86, TypeScript ~6.0, Drizzle over expo-sqlite, `expo-sensors` (Barometer + Pedometer), `expo-file-system` (already installed), `expo-sharing`, `expo-battery`, Bun.

**Spec:** [2026-08-03 barometer field-logging design](../specs/2026-08-03-run-barometer-field-logging-design.md) (revision 3). **Capture protocol:** [docs/field-test-capture-protocol.md](../../field-test-capture-protocol.md).

## Global Constraints

- **`toFixed` is forbidden** for `pressureHpa`, `relativeAltitudeM`, `lat`, `lng`. `String(n)` is shortest-round-trip and lossless; 1 dp on pressure is a 0.83 m altitude quantum, comparable to the barometer's entire precision advantage over GPS (spec §7.1).
- **Nothing may fail a run.** Every capture call is individually wrapped and fire-and-forget, warning to console only (spec §6.2, `services/haptics/adapter.ios.ts` is the precedent).
- **No composite primary key on `run_altitude_samples` or `run_log`.** A PK would abort the shared GPS transaction on any crash-resumed run (spec §5.1).
- **`bun test` imports are `import { describe, expect, test } from 'bun:test'`** — `test`, not `it`.
- **`src/db/migrations/` is generated only**, via `bun run db:generate`. Never hand-write a migration; a `PreToolUse` hook blocks it.
- **`src/domain/` imports nothing from `@/db` or `@/services`** — it is pure TS covered by `bun test` with no RN runtime.
- **Comments explain WHY, never WHAT** (AGENTS.md). No JSDoc restating types. Reference ADRs rather than re-explaining them.
- **`export COREPACK_ENABLE_AUTO_PIN=0`** before any Expo command, and never commit a `packageManager` field in `package.json`.
- **Conventional Commits** for every commit message.
- Cadence facts that must not be re-litigated: `Barometer.setUpdateInterval` is an iOS no-op; `BarometerMeasurement` is `{ pressure, relativeAltitude?, timestamp }` where `timestamp` is boot-relative seconds; `Barometer`'s permission functions are hardcoded `granted: true` fakes, so permission goes through `Pedometer`.

### Correction to the spec, found while planning

Spec §8.3.1 and §11 say "the entire export pipeline can be built and exercised on the current dev-client build with no rebuild." That is **half true**: `expo-file-system` is already installed and linked, but **`expo-sharing` is not** — it is one of the three new native modules. So what is genuinely provable before the rebuild is Tasks 1–3: the schema, the fix-path change, and the serializer (pure, `bun test`) — which is where all the precision and escaping risk lives. The share sheet and the summary row (Task 5) need the rebuild. Tasks are ordered accordingly.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/services/elevation/port.ts` | The ADR 0015 port: `ElevationSource`, `AltitudeReading`, `MotionPermissionStatus`. Source-agnostic. |
| `src/services/elevation/adapter.ios.ts` | `expo-sensors` Barometer behind one permanent native subscription, fanning out in JS. Permission via `Pedometer`. |
| `src/services/elevation/index.ts` | Re-exports; the only import site for consumers. |
| `src/services/run-engine/run-log.ts` | Buffers, per-run `seq` counters, caps, drop counters, and typed entry constructors. Keeps `engine.ts` free of inline JSON. |
| `src/domain/run-export.ts` | PURE: rows → the export string. Owns precision and CSV escaping. |
| `src/services/run-export.ts` | Reads the rows, calls the serializer, writes to cache, opens the share sheet. |
| `src/components/run-export-row.tsx` | The summary affordance, with the capture counts. |
| `src/services/field-test.ts` | The `EXPO_PUBLIC_FIELD_TEST` flag, the `field-test` session key, and the synthetic session. |
| `src/components/field-test-row.tsx` | The gated Settings row that starts a capture. |
| `src/db/run-log.ts` | Imperative readers for the two new tables (never `useLiveQuery` — ADR 0004 §3). |

**Modified** — the full list is spec §12. Each task names its own.

---

## Task 1: Schema and migration

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/migrations/` output (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: tables `runAltitudeSamples` (`runId: string, seq: number, at: string, sensorTimestampS: number | null, pressureHpa: number, relativeAltitudeM: number | null, epoch: number, segmentSeq: number`) and `runLog` (`runId: string, seq: number, at: string, kind: string, detailJson: string | null`); columns `runPoints.altitudeAccuracy: number | null`, `runs.eventLogJson: string | null`, `runs.motionPermission: string | null`. Row types `AltitudeSampleRow = typeof runAltitudeSamples.$inferSelect` and `RunLogRow = typeof runLog.$inferSelect`.

- [ ] **Step 1: Add the two tables and three columns**

In `src/db/schema.ts`, add to the `runs` table definition, after `healthkitSaved`:

```ts
  eventLogJson: text('event_log_json'),
  motionPermission: text('motion_permission'),
```

Add to the `runPoints` column object, after `accuracy`:

```ts
    altitudeAccuracy: real('altitude_accuracy'),
```

Append the two new tables after `runPoints`:

```ts
/**
 * Raw barometer readings at the sensor's own cadence — product data, not diagnostics:
 * the render slice folds these through `domain/elevation.ts` (ADR 0015 item 5).
 *
 * why no primary key, unlike `run_points`: `restore()` rebuilds the point `seq` counter and
 * nothing rebuilds this one, so a `(run_id, seq)` PK made a resumed run's first flush throw
 * UNIQUE — and because that insert shares the GPS transaction, the throw rolled back the GPS
 * points too, for the rest of the run. `seq` is a plain ordering column; nothing joins on it.
 * Exempt from ADR 0004 §5's UUID + timestamps + soft-delete rule for the same reason
 * `run_points` is: append-only rows whose own `at` is their temporal record.
 */
export const runAltitudeSamples = sqliteTable('run_altitude_samples', {
  runId: text('run_id')
    .notNull()
    .references(() => runs.id),
  seq: integer('seq').notNull(),
  at: text('at').notNull(),
  /** CoreMotion's boot-relative clock. Paired with `at` it separates a sampling gap from a JS-scheduling one. */
  sensorTimestampS: real('sensor_timestamp_s'),
  pressureHpa: real('pressure_hpa').notNull(),
  relativeAltitudeM: real('relative_altitude_m'),
  epoch: integer('epoch').notNull(),
  segmentSeq: integer('segment_seq').notNull(),
});

/**
 * Field-log entries for one run. `kind` is plain text, never a Drizzle enum: an enum would
 * force a migration for every new signal, which is the one thing this table exists to avoid.
 * Same PK and ADR 0004 §5 exemptions as `run_altitude_samples` above.
 */
export const runLog = sqliteTable('run_log', {
  runId: text('run_id')
    .notNull()
    .references(() => runs.id),
  seq: integer('seq').notNull(),
  at: text('at').notNull(),
  kind: text('kind').notNull(),
  detailJson: text('detail_json'),
});
```

Add to the exported row types at the bottom of the file:

```ts
export type AltitudeSampleRow = typeof runAltitudeSamples.$inferSelect;
export type RunLogRow = typeof runLog.$inferSelect;
```

- [ ] **Step 2: Generate the migration**

Run: `export COREPACK_ENABLE_AUTO_PIN=0 && bun run db:generate`
Expected: a new `src/db/migrations/000N_*.sql` plus an updated `meta/_journal.json`. Read the SQL and confirm it is three `ALTER TABLE … ADD COLUMN` statements and two `CREATE TABLE` statements — **no** `PRAGMA`/table-rebuild sequence. All three columns are nullable with no default, so SQLite adds them in place.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: clean. (In a fresh worktree this needs `bun expo start` once to generate `.expo/types/router.d.ts` — see AGENTS.md.)

- [ ] **Step 4: Commit**

```bash
git add -- src/db/schema.ts src/db/migrations
git commit -m "feat(db): add barometer sample and field-log tables"
```

---

## Task 2: Vertical accuracy through the fix path

**Files:**
- Modify: `src/domain/geo.ts` (the `LocationFix` interface)
- Modify: `src/services/location-tracker/adapter.ios.ts` (`toFix`)
- Modify: `src/services/run-engine/types.ts` (`BufferedRunPoint`)
- Modify: `src/services/run-engine/engine.ts` (the `toFix` helper ~line 153, and the point built in `ingestFix` ~line 447)
- Modify: `src/db/run-points.ts` (`loadBufferedRunPoints` mapper)
- Modify: `src/services/run-store/index.ts` (the insert mapper)
- Modify: `src/services/run-engine/resumable.ts` (`parseFix`)
- Test: `src/domain/geo.test.ts`

**Interfaces:**
- Consumes: Task 1's `runPoints.altitudeAccuracy`.
- Produces: `LocationFix.altitudeAccuracy?: number | null` and `BufferedRunPoint.altitudeAccuracy?: number | null`.

**Why optional:** a required field would break ~14 existing fix literals across `geo.test.ts`, `run-profile.test.ts`, `health.test.ts` and `engine.test.ts`. Optional keeps this task to the production path.

- [ ] **Step 1: Write the failing test**

Append to `src/domain/geo.test.ts`:

```ts
describe('altitudeAccuracy', () => {
  test('a fix carrying vertical accuracy keeps it, and a negative value is preserved verbatim', () => {
    // why verbatim: CoreLocation reports a NEGATIVE verticalAccuracy to mean "altitude invalid".
    // Clamping it here would erase that signal; the analysis applies the rule (spec §5.2).
    const fix: LocationFix = {
      timestamp: 1_000_000,
      lat: 59.3,
      lng: 18.0,
      altitude: 12,
      accuracy: 5,
      altitudeAccuracy: -1,
      speed: 2,
    };
    expect(fix.altitudeAccuracy).toBe(-1);
  });

  test('a fix without vertical accuracy is still a valid LocationFix', () => {
    const fix: LocationFix = {
      timestamp: 1_000_000,
      lat: 59.3,
      lng: 18.0,
      altitude: null,
      accuracy: 5,
      speed: null,
    };
    expect(fix.altitudeAccuracy).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test src/domain/geo.test.ts`
Expected: FAIL — TypeScript rejects `altitudeAccuracy` as an unknown property on `LocationFix`.

- [ ] **Step 3: Add the field and thread it through**

In `src/domain/geo.ts`, add to `LocationFix` after `accuracy`:

```ts
  /** Vertical accuracy in metres. NEGATIVE means iOS considers `altitude` invalid — never clamp it. */
  altitudeAccuracy?: number | null;
```

In `src/services/location-tracker/adapter.ios.ts`'s `toFix`, add `altitudeAccuracy: location.coords.altitudeAccuracy` alongside `accuracy`.

In `src/services/run-engine/types.ts`, add `altitudeAccuracy?: number | null;` to `BufferedRunPoint` after `accuracy`.

In `src/services/run-engine/engine.ts`: add `altitudeAccuracy: point.altitudeAccuracy` to the `toFix` helper's returned object, and `altitudeAccuracy: fix.altitudeAccuracy ?? null` to the point built in `ingestFix`.

In `src/db/run-points.ts`'s `loadBufferedRunPoints` mapper, add `altitudeAccuracy: row.altitudeAccuracy,`.

In `src/services/run-store/index.ts`'s insert mapper, add `altitudeAccuracy: p.altitudeAccuracy ?? null,`.

In `src/services/run-engine/resumable.ts`'s `parseFix`, carry the field through, tolerating its absence in a snapshot written by an older build:

```ts
    altitudeAccuracy: typeof raw.altitudeAccuracy === 'number' ? raw.altitudeAccuracy : null,
```

- [ ] **Step 4: Run the tests**

Run: `bun test && bun run typecheck`
Expected: PASS, clean typecheck, and no existing test needs editing.

- [ ] **Step 5: Commit**

```bash
git add -- src/domain/geo.ts src/domain/geo.test.ts src/services/location-tracker/adapter.ios.ts src/services/run-engine/types.ts src/services/run-engine/engine.ts src/services/run-engine/resumable.ts src/db/run-points.ts src/services/run-store/index.ts
git commit -m "feat: record each fix's vertical accuracy"
```

---

## Task 3: The pure export serializer

**Files:**
- Create: `src/domain/run-export.ts`
- Test: `src/domain/run-export.test.ts`

**Interfaces:**
- Consumes: nothing (pure; structural input types are declared here so `domain/` imports no `@/db`).
- Produces: `toRunExport(input: RunExportInput): string`, `RUN_EXPORT_MAGIC`, `RUN_EXPORT_SCHEMA`, and the input types `RunExportInput`, `RunExportDevice`, `ExportRun`, `ExportSegment`, `ExportPoint`, `ExportAltitudeSample`, `ExportLogEntry`, `ExportEvent`.

- [ ] **Step 1: Write the failing test**

Create `src/domain/run-export.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { RUN_EXPORT_MAGIC, toRunExport, type RunExportInput } from './run-export';

function input(overrides: Partial<RunExportInput> = {}): RunExportInput {
  return {
    exportedAt: '2026-08-04T10:00:00.000Z',
    device: { model: 'iPhone15,2', osVersion: '26.5', appVersion: '0.1.0', updateId: null, barometerAvailable: true, motionPermission: 'granted', timezoneOffsetMin: -120 },
    run: { id: 'run-1', sessionKey: 'w1d1', status: 'completed', startedAt: '2026-08-04T09:00:00.000Z', endedAt: '2026-08-04T09:30:00.000Z', activeDurationS: 1800, distanceM: 2760.5 },
    segments: [{ seq: 0, kind: 'warmup', plannedDurationS: 300, actualDurationS: 301, distanceM: 400, wasSkipped: false }],
    points: [{ seq: 0, at: '2026-08-04T09:00:01.000Z', lat: 59.329323, lng: 18.068581, altitudeM: 12.25, accuracyM: 5, altitudeAccuracyM: -1, speedMps: 2.1, segmentSeq: 0 }],
    samples: [{ seq: 0, at: '2026-08-04T09:00:02.000Z', sensorTimestampS: 12345.678, pressureHpa: 1013.257, relativeAltitudeM: 0, epoch: 1, segmentSeq: 0 }],
    log: [{ seq: 0, at: '2026-08-04T09:00:00.500Z', kind: 'sensor', detailJson: '{"available":true}' }],
    events: [{ at: 1_000_000, type: 'start' }],
    ...overrides,
  };
}

describe('toRunExport', () => {
  test('opens with the magic line and a single-line JSON header carrying counts', () => {
    const lines = toRunExport(input()).split('\n');
    expect(lines[0]).toBe(`# ${RUN_EXPORT_MAGIC}`);
    const header = JSON.parse(lines[1]) as { counts: Record<string, number> };
    expect(header.counts).toEqual({ segments: 1, points: 1, altitude: 1, log: 1, events: 1 });
  });

  test('emits every section header even when a section is empty', () => {
    const text = toRunExport(input({ samples: [], points: [] }));
    for (const name of ['segments', 'points', 'altitude', 'log', 'events']) {
      expect(text).toContain(`## ${name}`);
    }
  });

  test('numbers round-trip exactly — toFixed anywhere here would cost 0.83 m per 1 dp of pressure', () => {
    const text = toRunExport(input());
    expect(text).toContain('1013.257');
    expect(text).toContain('59.329323');
    expect(text).toContain('12345.678');
  });

  test('a null number becomes an empty field, not the string "null"', () => {
    const text = toRunExport(
      input({ samples: [{ seq: 0, at: 'x', sensorTimestampS: null, pressureHpa: 1013, relativeAltitudeM: null, epoch: 1, segmentSeq: 0 }] }),
    );
    // why scoped to the section: the JSON header legitimately serializes `"updateId":null`, so a
    // whole-file assertion would test the header's shape rather than the CSV's null handling.
    const section = text.slice(text.indexOf('## altitude'), text.indexOf('## log'));
    expect(section).toContain('0,x,,1013,,1,0');
    expect(section).not.toContain('null');
  });

  test('escapes a detail payload containing a comma, a quote, a newline and a section marker', () => {
    const detailJson = JSON.stringify({ note: 'a,b "q"\n## points' });
    const text = toRunExport(input({ log: [{ seq: 0, at: 'x', kind: 'cue', detailJson }] }));
    // why sliced to just this section: the log section is followed by `## events`, so slicing to
    // end-of-file would count that real header and prove nothing about forgery.
    const body = text.slice(text.indexOf('## log'), text.indexOf('## events'));
    // JSON.stringify escapes the newline as two characters, so the payload cannot forge a section.
    expect(body.split('\n').filter((l) => l.startsWith('## ')).length).toBe(1);
    // the JSON key's own quotes are real quotes, so CSV escaping doubles them.
    expect(body).toContain('""note""');
  });

  test('ends with exactly one newline', () => {
    const text = toRunExport(input());
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test src/domain/run-export.test.ts`
Expected: FAIL — `Cannot find module './run-export'`.

- [ ] **Step 3: Implement the serializer**

Create `src/domain/run-export.ts`:

```ts
/** Pure run-export serialization — no React/Expo/DB imports (ADR 0003). */

export const RUN_EXPORT_MAGIC = 'runbro-export/1';
export const RUN_EXPORT_SCHEMA = 1;

export interface RunExportDevice {
  model: string;
  osVersion: string;
  appVersion: string;
  updateId: string | null;
  barometerAvailable: boolean;
  motionPermission: string | null;
  timezoneOffsetMin: number;
}

export interface ExportRun {
  id: string;
  sessionKey: string;
  status: string;
  startedAt: string;
  endedAt: string;
  activeDurationS: number;
  distanceM: number | null;
}

export interface ExportSegment {
  seq: number;
  kind: string;
  plannedDurationS: number;
  actualDurationS: number;
  distanceM: number | null;
  wasSkipped: boolean;
}

export interface ExportPoint {
  seq: number;
  at: string;
  lat: number;
  lng: number;
  altitudeM: number | null;
  accuracyM: number | null;
  altitudeAccuracyM: number | null;
  speedMps: number | null;
  segmentSeq: number;
}

export interface ExportAltitudeSample {
  seq: number;
  at: string;
  sensorTimestampS: number | null;
  pressureHpa: number;
  relativeAltitudeM: number | null;
  epoch: number;
  segmentSeq: number;
}

export interface ExportLogEntry {
  seq: number;
  at: string;
  kind: string;
  detailJson: string | null;
}

export interface ExportEvent {
  at: number;
  type: string;
}

export interface RunExportInput {
  exportedAt: string;
  device: RunExportDevice;
  run: ExportRun;
  segments: readonly ExportSegment[];
  points: readonly ExportPoint[];
  samples: readonly ExportAltitudeSample[];
  log: readonly ExportLogEntry[];
  events: readonly ExportEvent[];
}

// why String and never toFixed: shortest-round-trip is lossless, while 1 dp on pressure imposes a
// 0.83 m altitude quantum — the barometer's whole precision advantage over GPS (spec §7.1).
function num(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

function csv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function section(name: string, columns: string, rows: readonly string[]): string[] {
  return [`## ${name}`, columns, ...rows, ''];
}

/** One run as a `#` magic line, a single-line JSON header, then CSV sections (spec §7.1). Ends with exactly one newline. */
export function toRunExport(input: RunExportInput): string {
  const { run, segments, points, samples, log, events } = input;

  const header = {
    schema: RUN_EXPORT_SCHEMA,
    exportedAt: input.exportedAt,
    run,
    device: input.device,
    counts: {
      segments: segments.length,
      points: points.length,
      altitude: samples.length,
      log: log.length,
      events: events.length,
    },
  };

  const lines = [
    `# ${RUN_EXPORT_MAGIC}`,
    JSON.stringify(header),
    '',
    ...section(
      'segments',
      'seq,kind,plannedDurationS,actualDurationS,distanceM,wasSkipped',
      segments.map((s) =>
        [s.seq, csv(s.kind), s.plannedDurationS, s.actualDurationS, num(s.distanceM), s.wasSkipped ? 1 : 0].join(','),
      ),
    ),
    ...section(
      'points',
      'seq,at,lat,lng,altitudeM,accuracyM,altitudeAccuracyM,speedMps,segmentSeq',
      points.map((p) =>
        [p.seq, csv(p.at), num(p.lat), num(p.lng), num(p.altitudeM), num(p.accuracyM), num(p.altitudeAccuracyM), num(p.speedMps), p.segmentSeq].join(','),
      ),
    ),
    ...section(
      'altitude',
      'seq,at,sensorTimestampS,pressureHpa,relativeAltitudeM,epoch,segmentSeq',
      samples.map((s) =>
        [s.seq, csv(s.at), num(s.sensorTimestampS), num(s.pressureHpa), num(s.relativeAltitudeM), s.epoch, s.segmentSeq].join(','),
      ),
    ),
    ...section(
      'log',
      'seq,at,kind,detailJson',
      log.map((e) => [e.seq, csv(e.at), csv(e.kind), csv(e.detailJson ?? '')].join(',')),
    ),
    ...section(
      'events',
      'at,type',
      events.map((e) => [e.at, csv(e.type)].join(',')),
    ),
  ];

  return `${lines.join('\n').trimEnd()}\n`;
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/domain/run-export.test.ts && bun run lint`
Expected: PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add -- src/domain/run-export.ts src/domain/run-export.test.ts
git commit -m "feat(domain): serialize a run's full data for field export"
```

---

## Task 4: Dependencies, the motion permission string, and the native boundary

**Files:**
- Modify: `package.json` (via `bun expo install`)
- Modify: `app.json` (the `expo-sensors` plugin entry)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `expo-sensors`, `expo-sharing`, `expo-battery` installed; `expo-file-system` promoted to a direct dependency; `NSMotionUsageDescription` present in the built app.

**This task is the native boundary.** Everything after it requires a fresh build.

- [ ] **Step 1: Install the dependencies**

```bash
export COREPACK_ENABLE_AUTO_PIN=0
bun expo install expo-sensors expo-sharing expo-battery expo-file-system
```

`expo-file-system` is already present transitively (a dependency of `expo`, linked at `ios/Podfile.lock`); installing it makes the direct import honest.

- [ ] **Step 2: Check `package.json` for the corepack injection**

Read `package.json`. If a `"packageManager": "yarn@…"` field appeared, **delete it** — a committed one can make EAS Build honor Yarn over `bun.lock` (AGENTS.md).

- [ ] **Step 3: Add the plugin entry that supplies the permission string**

In `app.json`'s `plugins` array, add:

```json
[
  "expo-sensors",
  {
    "motionPermission": "RunBro reads the barometer to measure how much you climbed on a run. It never leaves your phone."
  }
]
```

Without this, `NSMotionUsageDescription` is absent and **iOS terminates the app** on first altimeter use.

- [ ] **Step 4: Add the export landing directory to `.gitignore`**

Append:

```
# Field-test exports: they contain the runner's home coordinates (start and finish of every run)
/field-data/
```

- [ ] **Step 5: Verify the config resolves and the fingerprint moved**

```bash
bunx expo-doctor
bunx expo config --type prefix 2>/dev/null | grep -i motion || true
bunx @expo/fingerprint fingerprint:generate --platform ios | head -3
```
Expected: expo-doctor green; the motion string present in the resolved config; a fingerprint hash different from the one in `git show HEAD:package.json`'s era (any change is expected — three new native modules).

- [ ] **Step 6: Rebuild the dev client and confirm the app launches**

```bash
bun run prebuild:dev
bun run start
```
Expected: the app builds, installs and launches. A launch crash mentioning a native module means autolinking did not pick a package up.

- [ ] **Step 7: Commit**

```bash
git add -- package.json bun.lock app.json .gitignore
git commit -m "build: add expo-sensors, expo-sharing and expo-battery"
```

---

## Task 5: The export service, its row, and the summary wiring

**Files:**
- Create: `src/services/run-export.ts`
- Create: `src/db/run-log.ts`
- Create: `src/components/run-export-row.tsx`
- Modify: `src/app/runs/[runId]/index.tsx`
- Test: `src/db/run-log.test.ts` is **not** created (DB readers need the RN runtime); coverage is Task 3's serializer plus the manual simulator pass in Step 5.

**Interfaces:**
- Consumes: Task 3's `toRunExport`; Task 1's `runAltitudeSamples` / `runLog`.
- Produces: `loadAltitudeSamples(runId): ExportAltitudeSample[]`, `loadRunLog(runId): ExportLogEntry[]`, `loadRunCounts(runId): { points: number; samples: number }`, `exportRun(runId): Promise<'shared' | 'unavailable' | 'failed'>`, and `<RunExportRow run={run} />`.

- [ ] **Step 1: Write the imperative readers**

Create `src/db/run-log.ts`:

```ts
import { asc, eq } from 'drizzle-orm';

import type { ExportAltitudeSample, ExportLogEntry } from '@/domain/run-export';
import { db } from './client';
import { runAltitudeSamples, runLog, runPoints } from './schema';

/** Imperative by design: ADR 0004 §3 forbids `useLiveQuery` over the per-run streams. */
export function loadAltitudeSamples(runId: string): ExportAltitudeSample[] {
  return db
    .select()
    .from(runAltitudeSamples)
    .where(eq(runAltitudeSamples.runId, runId))
    .orderBy(asc(runAltitudeSamples.seq))
    .all();
}

export function loadRunLog(runId: string): ExportLogEntry[] {
  return db.select().from(runLog).where(eq(runLog.runId, runId)).orderBy(asc(runLog.seq)).all();
}

export function loadRunCounts(runId: string): { points: number; samples: number } {
  return {
    points: db.select().from(runPoints).where(eq(runPoints.runId, runId)).all().length,
    samples: loadAltitudeSamples(runId).length,
  };
}
```

- [ ] **Step 2: Write the export service**

Create `src/services/run-export.ts`:

```ts
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { db } from '@/db/client';
import { loadAltitudeSamples, loadRunLog } from '@/db/run-log';
import { loadRunFixes } from '@/db/run-points';
import { runNotDeleted } from '@/db/queries';
import { runs, runSegments } from '@/db/schema';
import { toRunExport, type ExportEvent, type ExportPoint } from '@/domain/run-export';
import { and, asc, eq } from 'drizzle-orm';

function fileName(runId: string, startedAt: string): string {
  const stamp = startedAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  return `runbro-${stamp}-${runId.slice(0, 8)}.txt`;
}

/**
 * Writes one run's full data to the cache and opens the system share sheet. Never throws —
 * the caller shows the outcome. Not reachable while a run is live: the reads are synchronous
 * and would stall the heartbeat (spec §7.2).
 */
export async function exportRun(runId: string): Promise<'shared' | 'unavailable' | 'failed'> {
  try {
    const run = db
      .select()
      .from(runs)
      .where(and(eq(runs.id, runId), runNotDeleted))
      .all()[0];
    if (!run) return 'unavailable';

    const segments = db
      .select()
      .from(runSegments)
      .where(eq(runSegments.runId, runId))
      .orderBy(asc(runSegments.seq))
      .all();

    const points: ExportPoint[] = loadRunFixes(runId).map((fix, index) => ({
      seq: index,
      at: new Date(fix.timestamp).toISOString(),
      lat: fix.lat,
      lng: fix.lng,
      altitudeM: fix.altitude,
      accuracyM: fix.accuracy,
      altitudeAccuracyM: fix.altitudeAccuracy ?? null,
      speedMps: fix.speed,
      segmentSeq: fix.segmentSeq,
    }));

    let events: ExportEvent[] = [];
    if (run.eventLogJson) {
      try {
        events = JSON.parse(run.eventLogJson) as ExportEvent[];
      } catch {
        events = [];
      }
    }

    const text = toRunExport({
      exportedAt: new Date().toISOString(),
      device: {
        model: Device.modelId ?? 'unknown',
        osVersion: String(Platform.Version),
        appVersion: Constants.expoConfig?.version ?? 'unknown',
        updateId: Constants.expoConfig?.extra?.updateId ?? null,
        barometerAvailable: loadAltitudeSamples(runId).length > 0,
        motionPermission: run.motionPermission,
        timezoneOffsetMin: new Date().getTimezoneOffset(),
      },
      run: {
        id: run.id,
        sessionKey: run.sessionKey,
        status: run.status,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        activeDurationS: run.activeDurationS,
        distanceM: run.distanceM,
      },
      segments: segments.map((s) => ({
        seq: s.seq,
        kind: s.kind,
        plannedDurationS: s.plannedDurationS,
        actualDurationS: s.actualDurationS,
        distanceM: s.distanceM,
        wasSkipped: s.wasSkipped,
      })),
      points,
      samples: loadAltitudeSamples(runId),
      log: loadRunLog(runId),
      events,
    });

    const file = new File(Paths.cache, fileName(runId, run.startedAt));
    // why overwrite: the name is deterministic per run, and re-exporting a run is a supported
    // action — `create()` throws when the file already exists.
    file.create({ overwrite: true });
    file.writeSync(text);

    if (!(await Sharing.isAvailableAsync())) return 'unavailable';
    await Sharing.shareAsync(file.uri, { UTI: 'public.plain-text', mimeType: 'text/plain' });
    return 'shared';
  } catch (error) {
    console.warn('[run-export] export failed', error);
    return 'failed';
  }
}
```

If `expo-device` is not installed, drop the `Device.modelId` line and use `Constants.deviceName ?? 'unknown'` instead — do **not** add a fourth native module for one header field.

- [ ] **Step 3: Write the row component**

Create `src/components/run-export-row.tsx`, modelled on `src/components/health-status-row.tsx` (read it first and match its `Card` + `ui/text` + `Island.Button` composition):

```tsx
import { useState } from 'react';
import { View } from 'react-native';

import { Island } from '@/components/island';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { loadRunCounts } from '@/db/run-log';
import type { Run } from '@/db/schema';
import { exportRun } from '@/services/run-export';

/**
 * Field-data export (spec §7.3). The counts are the only in-app confirmation that capture
 * worked, so they are checkable before a 30-minute run's data is trusted.
 */
export function RunExportRow({ run }: { run: Run }) {
  const [counts] = useState(() => loadRunCounts(run.id));
  const [status, setStatus] = useState<'idle' | 'busy' | 'failed'>('idle');

  return (
    <Card surface="card" className="gap-3">
      <View className="gap-1">
        <Text variant="footnote" tone="secondary" className="font-semibold" accessibilityRole="header">
          Field data
        </Text>
        <Text variant="caption" tone="secondary">
          {status === 'failed'
            ? 'Export failed — see the logs.'
            : `${counts.points} GPS fixes · ${counts.samples} altitude samples`}
        </Text>
      </View>
      <Island.Button
        testID="export-run-data"
        disabled={status === 'busy'}
        onPress={() => {
          setStatus('busy');
          void exportRun(run.id).then((result) => {
            setStatus(result === 'shared' ? 'idle' : 'failed');
          });
        }}
      >
        {status === 'busy' ? 'Preparing…' : 'Export run data'}
      </Island.Button>
    </Card>
  );
}
```

- [ ] **Step 4: Render it on the summary**

In `src/app/runs/[runId]/index.tsx`, import `RunExportRow` and render it after `<HealthStatusRow run={run} />`.

- [ ] **Step 5: Verify on the simulator**

Load the `verify` skill and use it. Boot the simulator, open a previously recorded run's summary, confirm the row shows a nonzero fix count and `0 altitude samples`, tap Export, and confirm the share sheet opens. The empty altitude section is the expected state until Task 9.

- [ ] **Step 6: Commit**

```bash
git add -- src/db/run-log.ts src/services/run-export.ts src/components/run-export-row.tsx "src/app/runs/[runId]/index.tsx"
git commit -m "feat: export one run's full data to a text file"
```

---

## Task 6: The elevation port and its iOS adapter

**Files:**
- Create: `src/services/elevation/port.ts`
- Create: `src/services/elevation/adapter.ios.ts`
- Create: `src/services/elevation/index.ts`
- Create: `src/services/elevation/use-motion-permission.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ElevationSource`, `AltitudeReading` (`{ at: number; sensorTimestampS: number | null; pressureHpa: number; relativeAltitudeM: number | null; epoch: number }`), `MotionPermissionStatus`, the `elevationSource` singleton, and `useMotionPermission()`.

- [ ] **Step 1: Write the port**

Create `src/services/elevation/port.ts`:

```ts
export interface AltitudeReading {
  /** Receipt wall clock, epoch ms — not monotonic; pair with `sensorTimestampS`. */
  at: number;
  /** CoreMotion's boot-relative clock, seconds. Monotonic. */
  sensorTimestampS: number | null;
  pressureHpa: number;
  relativeAltitudeM: number | null;
  epoch: number;
}

export type MotionPermissionStatus = 'granted' | 'denied' | 'undetermined';

/**
 * Elevation source (ADR 0015). Denial degrades, never blocks: with permission ungranted no
 * readings arrive, yet the run is unaffected — ADR 0008 §5's rule, applied to a second sensor.
 */
export interface ElevationSource {
  isAvailable(): Promise<boolean>;
  requestPermission(): Promise<MotionPermissionStatus>;
  getPermissionStatus(): Promise<MotionPermissionStatus>;
  /** Owns the single native subscription. Idempotent — a second call while running does nothing. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Registers into a JS fan-out; never touches the native subscription. */
  onReading(cb: (reading: AltitudeReading) => void): () => void;
}
```

- [ ] **Step 2: Write the adapter**

Create `src/services/elevation/adapter.ios.ts`:

```ts
import { Barometer, Pedometer } from 'expo-sensors';

import type { AltitudeReading, ElevationSource, MotionPermissionStatus } from './port';

// why one module-scope subscription with a JS fan-out: expo-sensors starts the native altimeter in
// `OnStartObserving` (first listener added) and STOPS it in `OnStopObserving` (last removed). A
// per-consumer listener would let an ordinary React unmount stop the altimeter, and the next
// subscribe would rebase `relativeAltitude` to 0 — the silent cliff (spec §4.2). Mirrors
// `location-tracker/adapter.ios.ts`'s listeners Set.
let subscription: { remove: () => void } | null = null;
let epoch = 0;
const listeners = new Set<(reading: AltitudeReading) => void>();

function toStatus(granted: boolean, canAskAgain: boolean): MotionPermissionStatus {
  if (granted) return 'granted';
  return canAskAgain ? 'undetermined' : 'denied';
}

// why Pedometer and not Barometer: `BarometerModule.swift` declares no permission functions, so
// `DeviceSensor` falls through to a hardcoded `{ granted: true }` and never prompts. Pedometer
// registers `EXMotionPermissionRequester`, and CoreMotion has ONE Motion & Fitness authorization
// shared by CMAltimeter and CMPedometer (spec §6.3).
export const elevationSource: ElevationSource = {
  async isAvailable() {
    try {
      return await Barometer.isAvailableAsync();
    } catch {
      return false;
    }
  },

  async requestPermission() {
    const { granted, canAskAgain } = await Pedometer.requestPermissionsAsync();
    return toStatus(granted, canAskAgain);
  },

  async getPermissionStatus() {
    const { granted, canAskAgain } = await Pedometer.getPermissionsAsync();
    return toStatus(granted, canAskAgain);
  },

  async start() {
    if (subscription) return;
    epoch += 1;
    const readingEpoch = epoch;
    subscription = Barometer.addListener((measurement) => {
      if (!Number.isFinite(measurement.pressure)) return;
      const relative = measurement.relativeAltitude;
      listeners.forEach((listener) => {
        listener({
          at: Date.now(),
          sensorTimestampS: Number.isFinite(measurement.timestamp) ? measurement.timestamp : null,
          pressureHpa: measurement.pressure,
          relativeAltitudeM: typeof relative === 'number' && Number.isFinite(relative) ? relative : null,
          epoch: readingEpoch,
        });
      });
    });
  },

  async stop() {
    subscription?.remove();
    subscription = null;
  },

  onReading(cb) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};
```

- [ ] **Step 3: Write the index and the permission hook**

`src/services/elevation/index.ts`:

```ts
export type { AltitudeReading, ElevationSource, MotionPermissionStatus } from './port';

export { elevationSource } from './adapter';
export { useMotionPermission } from './use-motion-permission';
```

Create `src/services/elevation/use-motion-permission.ts` modelled on `src/services/location-tracker/use-location-permission.ts` — read that file and mirror its shape exactly, substituting `elevationSource` for `locationTracker`.

- [ ] **Step 4: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: clean. Note `adapter.ios.ts` resolves through `moduleSuffixes` (tsconfig) — the import in `index.ts` is `./adapter`, without the platform suffix, matching `location-tracker/index.ts`.

- [ ] **Step 5: Commit**

```bash
git add -- src/services/elevation
git commit -m "feat: add the elevation source port and its iOS barometer adapter"
```

---

## Task 7: The run-log buffers

**Files:**
- Create: `src/services/run-engine/run-log.ts`
- Test: `src/services/run-engine/run-log.test.ts`

**Interfaces:**
- Consumes: Task 6's `AltitudeReading`.
- Produces: `class RunLog` with `note(kind, detail)`, `sample(reading, segmentSeq, epochBase)`, `takeSamples(limit)`, `takeEntries(limit)`, `restoreFrom({ sampleSeq, entrySeq })`, `readonly pendingSamples`, `readonly pendingEntries`, plus `PendingSample` / `PendingEntry` types, `MAX_LOG_BUFFER`, `MAX_LOG_BATCH`, and `PROCESS_TOKEN`.

- [ ] **Step 1: Write the failing test**

Create `src/services/run-engine/run-log.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { MAX_LOG_BUFFER, RunLog } from './run-log';

function reading(overrides: Partial<Parameters<RunLog['sample']>[0]> = {}) {
  return { at: 1_000, sensorTimestampS: 10, pressureHpa: 1013, relativeAltitudeM: 0, epoch: 1, ...overrides };
}

describe('RunLog', () => {
  test('assigns seq at buffer time so a later drop shows as a gap', () => {
    const log = new RunLog();
    log.sample(reading(), 0, 0);
    log.sample(reading(), 0, 0);
    expect(log.pendingSamples.map((s) => s.seq)).toEqual([0, 1]);
  });

  test('drops a non-finite reading and never buffers it', () => {
    const log = new RunLog();
    log.sample(reading({ pressureHpa: Number.NaN }), 0, 0);
    expect(log.pendingSamples).toHaveLength(0);
  });

  test('a dropped reading still advances nothing, but is counted and logged', () => {
    const log = new RunLog();
    log.sample(reading({ pressureHpa: Number.POSITIVE_INFINITY }), 0, 0);
    expect(log.pendingEntries.some((e) => e.kind === 'samples_dropped')).toBe(true);
  });

  test('offsets epoch by the base so a resumed run is distinguishable from a fresh one', () => {
    const log = new RunLog();
    log.sample(reading({ epoch: 1 }), 0, 3);
    expect(log.pendingSamples[0].epoch).toBe(4);
  });

  test('caps the buffer by dropping the OLDEST instrumentation, and logs the drop', () => {
    const log = new RunLog();
    for (let i = 0; i < MAX_LOG_BUFFER + 5; i += 1) log.sample(reading({ at: i }), 0, 0);
    expect(log.pendingSamples).toHaveLength(MAX_LOG_BUFFER);
    expect(log.pendingSamples[0].at).toBeGreaterThan(0);
  });

  test('take() removes what it hands out so a successful flush cannot double-write', () => {
    const log = new RunLog();
    log.sample(reading(), 0, 0);
    const taken = log.takeSamples(10);
    expect(taken).toHaveLength(1);
    expect(log.pendingSamples).toHaveLength(0);
  });

  test('note() serializes its detail with JSON.stringify, which the export format relies on', () => {
    const log = new RunLog();
    log.note('lifecycle', { state: 'background' });
    expect(log.pendingEntries[0].detailJson).toBe('{"state":"background"}');
  });

  test('restoreFrom() continues seq past what is already stored', () => {
    const log = new RunLog();
    log.restoreFrom({ sampleSeq: 450, entrySeq: 1800 });
    log.sample(reading(), 0, 0);
    log.note('tick', null);
    expect(log.pendingSamples[0].seq).toBe(450);
    expect(log.pendingEntries[0].seq).toBe(1800);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test src/services/run-engine/run-log.test.ts`
Expected: FAIL — `Cannot find module './run-log'`.

- [ ] **Step 3: Implement it**

Create `src/services/run-engine/run-log.ts`:

```ts
import * as Crypto from 'expo-crypto';

import type { AltitudeReading } from '@/services/elevation';

/** why capped: if flushes are failing and retrying, instrumentation must not grow without bound. */
export const MAX_LOG_BUFFER = 4000;
/** why a separate batch cap: SQLite caps a statement at 32,766 bind parameters (engine.ts's MAX_FLUSH_POINTS). */
export const MAX_LOG_BATCH = 500;

/** Distinguishes a process boundary in the export, which `epoch` alone cannot (spec §4.2). */
export const PROCESS_TOKEN = Crypto.randomUUID();

export type RunLogKind =
  | 'tick'
  | 'fix_batch'
  | 'fix_rejected'
  | 'lifecycle'
  | 'battery'
  | 'cue'
  | 'sensor'
  | 'permission'
  | 'pedometer'
  | 'samples_dropped';

export interface PendingSample {
  seq: number;
  at: number;
  sensorTimestampS: number | null;
  pressureHpa: number;
  relativeAltitudeM: number | null;
  epoch: number;
  segmentSeq: number;
}

export interface PendingEntry {
  seq: number;
  at: number;
  kind: RunLogKind;
  detailJson: string | null;
}

/**
 * The run's instrumentation buffers. Owns `seq` so a drop is visible as a gap rather than as a
 * clean stretch indistinguishable from a suspension (spec §6.2).
 */
export class RunLog {
  private samples: PendingSample[] = [];
  private entries: PendingEntry[] = [];
  private nextSampleSeq = 0;
  private nextEntrySeq = 0;
  private dropped = 0;

  get pendingSamples(): readonly PendingSample[] {
    return this.samples;
  }

  get pendingEntries(): readonly PendingEntry[] {
    return this.entries;
  }

  restoreFrom({ sampleSeq, entrySeq }: { sampleSeq: number; entrySeq: number }): void {
    this.nextSampleSeq = sampleSeq;
    this.nextEntrySeq = entrySeq;
  }

  note(kind: RunLogKind, detail: unknown): void {
    let detailJson: string | null = null;
    if (detail !== null && detail !== undefined) {
      try {
        detailJson = JSON.stringify(detail);
      } catch {
        detailJson = null;
      }
    }
    this.push(this.entries, { seq: this.nextEntrySeq++, at: Date.now(), kind, detailJson });
  }

  sample(reading: AltitudeReading, segmentSeq: number, epochBase: number): void {
    if (!Number.isFinite(reading.pressureHpa)) {
      this.dropped += 1;
      this.note('samples_dropped', { reason: 'nonfinite', total: this.dropped });
      return;
    }
    this.push(this.samples, {
      seq: this.nextSampleSeq++,
      at: reading.at,
      sensorTimestampS: reading.sensorTimestampS,
      pressureHpa: reading.pressureHpa,
      relativeAltitudeM: reading.relativeAltitudeM,
      epoch: epochBase + reading.epoch,
      segmentSeq,
    });
  }

  takeSamples(limit = MAX_LOG_BATCH): PendingSample[] {
    return this.samples.splice(0, limit);
  }

  takeEntries(limit = MAX_LOG_BATCH): PendingEntry[] {
    return this.entries.splice(0, limit);
  }

  reset(): void {
    this.samples = [];
    this.entries = [];
    this.nextSampleSeq = 0;
    this.nextEntrySeq = 0;
    this.dropped = 0;
  }

  private push<T>(target: T[], item: T): void {
    target.push(item);
    if (target.length > MAX_LOG_BUFFER) {
      target.splice(0, target.length - MAX_LOG_BUFFER);
      this.dropped += 1;
    }
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/services/run-engine/run-log.test.ts`
Expected: PASS. If the cap test fails on the `samples_dropped` entry count, note the deliberate asymmetry: `push` counts a cap-drop but does not `note()` from inside itself (that would recurse into `push`); the counter surfaces on the next explicit drop or in the header counts.

- [ ] **Step 5: Commit**

```bash
git add -- src/services/run-engine/run-log.ts src/services/run-engine/run-log.test.ts
git commit -m "feat(engine): buffer barometer samples and field-log entries"
```

---

## Task 8: Extend the flush transaction

**Files:**
- Modify: `src/services/run-store/port.ts`
- Modify: `src/services/run-store/index.ts`
- Test: `src/services/run-engine/engine.test.ts` (the existing fake store)

**Interfaces:**
- Consumes: Task 7's `PendingSample` / `PendingEntry`; Task 1's tables.
- Produces: `RunStore.flush(runId, points, samples, entries, state): Promise<void>`, and `RunSnapshotState` gains `logSeq?: { sampleSeq: number; entrySeq: number }`.

- [ ] **Step 1: Widen the port**

In `src/services/run-store/port.ts`, change the `flush` signature and extend its doc comment to say samples and entries ride the *same* transaction. Add to `RunSnapshotState`:

```ts
  /** Watermarks so a resumed run's instrumentation `seq` continues instead of restarting (spec §5.1). Absent in snapshots written before this slice. */
  logSeq?: { sampleSeq: number; entrySeq: number };
```

```ts
  flush(
    runId: string,
    points: RunPoint[],
    samples: PendingSample[],
    entries: PendingEntry[],
    state: RunSnapshotState,
  ): Promise<void>;
```

- [ ] **Step 2: Write the transaction body**

In `src/services/run-store/index.ts`, inside the existing `db.transaction((tx) => {…})`, after the `runPoints` insert and before the snapshot upsert:

```ts
      // why the same transaction: a second writer would double the write rate at ~1 Hz and
      // reopen the divergence the atomic flush closes (ADR 0007 §5, run-store/port.ts).
      if (samples.length > 0) {
        tx.insert(runAltitudeSamples)
          .values(
            samples.map((s) => ({
              runId,
              seq: s.seq,
              at: new Date(s.at).toISOString(),
              sensorTimestampS: s.sensorTimestampS,
              pressureHpa: s.pressureHpa,
              relativeAltitudeM: s.relativeAltitudeM,
              epoch: s.epoch,
              segmentSeq: s.segmentSeq,
            })),
          )
          .run();
      }
      if (entries.length > 0) {
        tx.insert(runLog)
          .values(
            entries.map((e) => ({
              runId,
              seq: e.seq,
              at: new Date(e.at).toISOString(),
              kind: e.kind,
              detailJson: e.detailJson,
            })),
          )
          .run();
      }
```

Add `runAltitudeSamples, runLog` to the `@/db/schema` import.

- [ ] **Step 3: Update the fake store in the engine tests**

In `src/services/run-engine/engine.test.ts`, widen the fake `RunStore.flush` to the new arity and record the samples and entries it receives, so later tasks can assert on them.

- [ ] **Step 4: Run the tests**

Run: `bun test && bun run typecheck`
Expected: PASS. Every existing engine test still passes — the two new arrays are empty until Task 9.

- [ ] **Step 5: Commit**

```bash
git add -- src/services/run-store src/services/run-engine/engine.test.ts
git commit -m "feat(store): carry samples and log entries in the flush transaction"
```

---

## Task 9: Engine wiring

**Files:**
- Modify: `src/services/run-engine/engine.ts`
- Test: `src/services/run-engine/engine.test.ts`

**Interfaces:**
- Consumes: Tasks 6, 7, 8.
- Produces: `RunEngine` accepts `elevation: ElevationSource` in its constructor deps; `engine.note(kind, detail)` is public; samples reach `flush`.

- [ ] **Step 1: Write the failing tests**

Add to `src/services/run-engine/engine.test.ts` (mirroring the inline fake tracker at ~line 161):

```ts
function fakeElevation() {
  const listeners = new Set<(r: AltitudeReading) => void>();
  const calls: string[] = [];
  return {
    calls,
    emit(reading: AltitudeReading) {
      listeners.forEach((l) => l(reading));
    },
    source: {
      isAvailable: async () => true,
      requestPermission: async () => 'granted' as const,
      getPermissionStatus: async () => 'granted' as const,
      start: async () => {
        calls.push('start');
      },
      stop: async () => {
        calls.push('stop');
      },
      onReading: (cb: (r: AltitudeReading) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
  };
}
```

```ts
describe('barometer capture', () => {
  test('a reading delivered during a run reaches the flush', async () => {
    // build the engine with fakeElevation().source, start a run, emit a reading, advance to a flush
    // then assert the fake store received one sample carrying that pressure
  });

  test('a source that throws on start cannot fail the run', async () => {
    // start() rejects; assert the run still starts and the first flush still commits its points
  });

  test('the source is started on restore(), not only on start()', async () => {
    // restore a snapshot; assert calls includes 'start'
  });

  test('the source is stopped on reset() as well as finalize()', async () => {
    // assert 'stop' appears on both paths
  });
});
```

Fill each body in following the file's existing engine-construction and clock-advancing helpers — read the surrounding tests first and reuse them rather than inventing a second harness.

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/services/run-engine/engine.test.ts`
Expected: FAIL — the constructor rejects the `elevation` dep.

- [ ] **Step 3: Wire the engine**

1. Add `elevation: ElevationSource` to the constructor deps and store it.
2. Add `private log = new RunLog()`, `private elevationEpochBase = 0`, and `private elevationOps: Promise<unknown> = Promise.resolve()`.
3. Add `queueElevation(op, label)` mirroring `queueTracker` (~line 205) — the chain exists because "unordered, the old `stop()` can land after the new `start()`".
4. Subscribe once in the constructor: `this.elevation.onReading((r) => this.log.sample(r, this.currentSegmentSeq(), this.elevationEpochBase))`, wrapped in try/catch.
5. In `start()` (~line 245) and `restore()` (~line 303), alongside the existing `queueTracker(() => this.tracker.start(), 'start')`, add `queueElevation(() => this.elevation.start(), 'start')`.
6. In `finalize()` and `reset()` (~line 338), add `queueElevation(() => this.elevation.stop(), 'stop')`.
7. In `rebuild()` (~line 496), set `this.elevationEpochBase` and call `this.log.restoreFrom(...)` from the snapshot's `logSeq` (defaulting to the stored maxima the composition root passes in).
8. In `flushOnce`, pass `this.log.takeSamples()` and `this.log.takeEntries()` to `flush`, and on failure push them back to the front of their buffers so a retry re-sends them.
9. Emit one `tick` entry per flush attempt: `this.log.note('tick', null)`.
10. In `ingestFix`, on an accuracy-filter rejection, `this.log.note('fix_rejected', { at: fix.timestamp, accuracy: fix.accuracy, altitudeAccuracy: fix.altitudeAccuracy ?? null })`.
11. Add `note(kind: RunLogKind, detail: unknown): void` as a public method delegating to `this.log.note`.
12. Widen `drainPendingPoints`'s loop condition (~line 645) to `while (attempt < MAX_TAIL_FLUSHES && (this.pendingPoints.length > 0 || this.log.pendingSamples.length > 0 || this.log.pendingEntries.length > 0))` — otherwise every finalize-time entry is dropped, because the loop currently only runs when GPS points are pending.
13. Add `snapshotState`'s `logSeq` watermarks so a resume can continue them.
14. Centralize cue firing: add `private announce(cue: …)` that early-returns when `this.cuesSuppressed` is true, and replace direct `this.cue.announce(...)` calls with it. Set `cuesSuppressed` in `start()`/`restore()` from the session key (Task 12 supplies the predicate; until then it is always false).

- [ ] **Step 4: Run the tests**

Run: `bun test && bun run typecheck && bun run lint`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add -- src/services/run-engine/engine.ts src/services/run-engine/engine.test.ts
git commit -m "feat(engine): capture barometer readings into the run's flush"
```

---

## Task 10: Composition-root wiring

**Files:**
- Modify: `src/services/run-engine/index.ts`

**Interfaces:**
- Consumes: Task 9's `engine.note`; Task 6's `elevationSource`.
- Produces: `fix_batch`, `lifecycle`, `battery`, `sensor` entries reaching the log; `retryMotion()` alongside `retryTracking()`.

- [ ] **Step 1: Inject the port and log every delivered fix batch**

Pass `elevation: elevationSource` into `new RunEngine({…})` (~line 18-27).

Wrap the existing `locationTracker.onFix` callback (~line 34) so it records the batch before handing the fix on:

```ts
// why here and not in the engine: this is the ONLY place every delivered fix is visible.
// `ingestFix` never sees a fix delivered while paused, and CoreLocation batches deliveries —
// sixty fixes arriving after a sixty-second freeze look identical to continuous 1 Hz operation,
// because the stored timestamp is when the fix was DETERMINED (spec §6.1).
runEngine.note('fix_batch', { receivedAt: Date.now(), fixAt: fix.timestamp });
```

- [ ] **Step 2: Subscribe AppState and battery**

```ts
AppState.addEventListener('change', (state) => {
  runEngine.note('lifecycle', { state });
});

void Battery.getBatteryLevelAsync()
  .then((level) => runEngine.note('battery', { level }))
  .catch(() => undefined);
Battery.addLowPowerModeListener(({ lowPowerMode }) => {
  runEngine.note('battery', { lowPowerMode });
});
```

`expo-battery` is device-only — on the simulator these resolve to defaults or throw, and the wrapping absorbs it.

- [ ] **Step 3: Record the sensor's own state once per run start, and add the motion retry**

Where `locationTracker.start()` is awaited (~line 135), also record availability, permission and `PROCESS_TOKEN`:

```ts
const [available, permission] = await Promise.all([
  elevationSource.isAvailable(),
  elevationSource.getPermissionStatus(),
]);
runEngine.note('sensor', { available, permission, processToken: PROCESS_TOKEN });
```

Add `retryMotion()` mirroring `retryTracking()`, so a grant made mid-run through Settings starts capture for that run.

- [ ] **Step 4: Seed the resume watermarks**

Where `loadBufferedRunPoints(runId)` is loaded for `restore()` (~line 113), also read the stored maxima for the two new tables and pass them so `rebuild()` can continue `seq` and `epoch` rather than restart them.

- [ ] **Step 5: Typecheck, lint, and verify on the simulator**

Run: `bun run typecheck && bun run lint`, then run a short compressed session on the simulator and export it. Expected: `tick`, `fix_batch` and `lifecycle` rows present in the `## log` section; `## altitude` empty (no barometer on the simulator) — which is itself the degraded-path verification.

- [ ] **Step 6: Commit**

```bash
git add -- src/services/run-engine/index.ts
git commit -m "feat: log fix batches, lifecycle and battery during a run"
```

---

## Task 11: Finalize-time capture

**Files:**
- Modify: `src/services/run-engine/types.ts` (`CompletedRunRecord`)
- Modify: `src/services/run-engine/engine.ts` (finalize)
- Modify: `src/db/save-run.ts`

**Interfaces:**
- Consumes: Task 9.
- Produces: `CompletedRunRecord` gains `eventLogJson?: string` and `motionPermission?: string`; both are written on **both** finalize paths.

- [ ] **Step 1: Extend the record type**

In `src/services/run-engine/types.ts`, add to `CompletedRunRecord`:

```ts
  /** The event log, persisted because `active_run_snapshot` is cleared at finalize and it would otherwise be destroyed (spec §5.2). */
  eventLogJson?: string;
  motionPermission?: string;
```

- [ ] **Step 2: Populate them at finalize, and query the pedometer**

In `engine.ts`'s finalize, build the record with `eventLogJson: JSON.stringify(this.events)` and `motionPermission` from the last `sensor` note's permission. Before the final drain, query the step count — note the `Date` conversion, since the schema stores ISO text:

```ts
try {
  const { steps } = await Pedometer.getStepCountAsync(new Date(startedAt), new Date(endedAt));
  this.log.note('pedometer', { steps });
} catch (error) {
  console.warn('[engine] step count unavailable (non-fatal)', error);
}
```

- [ ] **Step 3: Write the columns on both paths**

In `src/db/save-run.ts`, write `eventLogJson` and `motionPermission` in `finalizeRun` **and** in the `saveRun` path — the latter is taken when no `'active'` row ever opened (`engine.ts:658`), and skipping it would silently leave those runs without an event log.

- [ ] **Step 4: Run the tests**

Run: `bun test && bun run typecheck`
Expected: PASS. Add one test asserting a finalized run's record carries a parseable `eventLogJson` containing the `start` event.

- [ ] **Step 5: Commit**

```bash
git add -- src/services/run-engine/types.ts src/services/run-engine/engine.ts src/db/save-run.ts src/services/run-engine/engine.test.ts
git commit -m "feat: persist the event log, motion permission and step count at finalize"
```

---

## Task 12: Field-test capture mode

**Files:**
- Create: `src/services/field-test.ts`
- Create: `src/components/field-test-row.tsx`
- Modify: `eas.json`
- Modify: `src/app/(tabs)/settings/index.tsx`
- Modify: `src/services/run-engine/index.ts` (the Health gate)
- Modify: `src/app/(tabs)/log/` (the label)
- Test: `src/services/field-test.test.ts`

**Interfaces:**
- Consumes: Task 9's `cuesSuppressed`.
- Produces: `FIELD_TEST_SESSION_KEY = 'field-test'`, `isFieldTestBuild()`, `isFieldTestRun(sessionKey)`, `fieldTestSession()`.

- [ ] **Step 1: Write the failing test**

Create `src/services/field-test.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { FIELD_TEST_SESSION_KEY, fieldTestSession, isFieldTestRun } from './field-test';

describe('field test', () => {
  test('its session key is not one any plan day claims, so completion has nothing to mark', () => {
    expect(FIELD_TEST_SESSION_KEY).toBe('field-test');
    expect(FIELD_TEST_SESSION_KEY).not.toMatch(/^w\d+d\d+$/);
  });

  test('isFieldTestRun identifies a capture and nothing else', () => {
    expect(isFieldTestRun(FIELD_TEST_SESSION_KEY)).toBe(true);
    expect(isFieldTestRun('w1d1')).toBe(false);
  });

  test('the session is one long segment, so there are no transitions to announce', () => {
    const session = fieldTestSession();
    expect(session.segments).toHaveLength(1);
    expect(session.segments[0].durationS).toBeGreaterThanOrEqual(3600);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/services/field-test.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Create `src/services/field-test.ts`, matching the shape `PlanSession` requires (read `src/domain/plan.ts` first and mirror its types exactly):

```ts
/**
 * Field-test captures (spec §8.0). A capture must NOT be a plan session: it would fire cues
 * during a stationary capture, mark a training day complete, and write a permanent Apple Health
 * workout — none of it reversible, since the app has no delete-run UI.
 *
 * The mechanism is the session key alone: no plan day claims it, so completion has nothing to mark.
 */
export const FIELD_TEST_SESSION_KEY = 'field-test';

/** Gated per EAS profile rather than on `__DEV__`, which is false in `preview` — the build the captures are taken with. */
export function isFieldTestBuild(): boolean {
  return process.env.EXPO_PUBLIC_FIELD_TEST === '1';
}

export function isFieldTestRun(sessionKey: string): boolean {
  return sessionKey === FIELD_TEST_SESSION_KEY;
}

export function fieldTestSession() {
  return {
    key: FIELD_TEST_SESSION_KEY,
    title: 'Field test capture',
    segments: [{ seq: 0, kind: 'walk' as const, durationS: 3600 }],
  };
}
```

- [ ] **Step 4: Add the flag, the row, the gates and the label**

1. `eas.json`: add `"env": { "EXPO_PUBLIC_FIELD_TEST": "1" }` to the `preview` profile.
2. Create `src/components/field-test-row.tsx` — a `Card` with an `Island.Button` (`testID="start-field-test"`) that requests motion permission then starts `fieldTestSession()` through the same path `session/[key].tsx` uses, and navigates to `/run`.
3. `src/app/(tabs)/settings/index.tsx`: render it inside `{isFieldTestBuild() ? <Section title="Field test">…</Section> : null}`, beside the existing `__DEV__` Developer section.
4. `src/services/run-engine/index.ts`: gate the Health sync — `withHealthSync(dbRunPersistence, (runId) => { … })` must skip when the record is a field-test run. Read the record's session key inside the gate rather than adding a parameter to the decorator.
5. Engine: set `cuesSuppressed = isFieldTestRun(session.key)` in `start()`/`restore()`.
6. `src/app/(tabs)/log/`: label a `field-test` row distinctly (e.g. "Field test" in place of the session title) so it cannot be misread as training. It stays **visible** — the export lives on the run summary, so a hidden capture would be unreachable.

- [ ] **Step 5: Verify on the simulator**

Run a short field-test capture: confirm no cues fire, the Log row is labelled, no plan day is marked complete, and the summary's export row works.

- [ ] **Step 6: Commit**

```bash
git add -- src/services/field-test.ts src/services/field-test.test.ts src/components/field-test-row.tsx eas.json "src/app/(tabs)/settings/index.tsx" "src/app/(tabs)/log" src/services/run-engine/index.ts src/services/run-engine/engine.ts
git commit -m "feat: add field-test capture mode, outside the training record"
```

---

## Task 13: Close out the docs

**Files:**
- Modify: `docs/adr/0015-run-elevation-on-device-barometer.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Amend ADR 0015**

Add an amendment recording what this slice settled: item 7's spike is discharged by field logging rather than a spike screen; item 5's columns landed as `run_altitude_samples`; `Barometer`'s permission functions are fakes so permission goes through `Pedometer`; `setUpdateInterval` is an iOS no-op so cadence is a constraint, not a knob; the rebase detector is pressure continuity, not the epoch; and the closure-error magnitudes from spec §2.1 (1–3 m calm, 5–15 m active) that make the doorstep brackets mandatory.

- [ ] **Step 2: Point AGENTS.md at the protocol**

In the "Current state" paragraph, note that barometer capture ships behind the `ElevationSource` port with field data exported per `docs/field-test-capture-protocol.md`, and that elevation is still unrendered pending tuning.

- [ ] **Step 3: Run every gate**

Run: `bun test && bun run typecheck && bun run lint && bunx expo-doctor`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -- docs/adr/0015-run-elevation-on-device-barometer.md AGENTS.md
git commit -m "docs: record what the barometer field-logging slice settled"
```

---

## After the plan: the build and the captures

The code is only half the slice. Once Task 13 is green:

1. `eas build --profile preview --platform ios` and install it. Every tuning change after this is JS-only and reaches the phone via `eas update --branch preview`.
2. Follow [docs/field-test-capture-protocol.md](../../field-test-capture-protocol.md). **Captures 1 and 2 first** — the 15-minute stationary capture and the tape-measured stairwell. Neither is a run, and they are the two the tuning is undecidable without.
3. Drop the exports in `field-data/` and hand them to a fresh session for analysis (spec §8.4–§8.6).

---

## Self-Review

**Spec coverage.** §1 no-UI scope → respected throughout (no task renders elevation). §2.1's corrected scoring → protocol doc + spec §8.5; no code. §3 architecture → Tasks 6–10. §4 port → Task 6. §4.1 both clocks → Tasks 1, 6. §4.2 pressure continuity + one permanent listener + epoch base → Tasks 6, 7, 9. §4.3 lifecycle (`start`/`restore`/`reset`/`finalize`, `elevationOps`, motion retry) → Tasks 9, 10. §5.1 tables without PKs, ADR 0004 exemption → Task 1. §5.2 three columns → Tasks 1, 2, 11. §6 capture table → Tasks 9, 10, 11. §6.1 `tick`/`fix_batch` → Tasks 9, 10. §6.2 four safety mechanisms → Tasks 7, 8, 9. §6.3 Pedometer permission + `app.json` plugin → Tasks 4, 6. §7.1 format and precision → Task 3. §7.2 file lifecycle, overwrite, privacy → Tasks 4, 5. §7.3 placement, imperative counts, `testID` → Task 5. §8.0 field-test mode → Task 12. §8.1–8.6 protocol → the protocol doc, plus "After the plan". §9 testing → each task's test steps. §11 build mechanics → Task 4 and "After the plan". §12 file list → covered; `docs/field-test-capture-protocol.md` already exists. §13 deferrals → correctly absent. §14 ADR impact → Task 13.

**Gap found and closed:** §12 item 16 (a `use-run-track.ts` sibling for the counts) is implemented as `loadRunCounts` in `src/db/run-log.ts` instead — a plain imperative reader is the right home, since the counts need no memoized hook. Recorded here so the difference from the spec's file list is deliberate.

**Placeholder scan.** No TBDs. Two tasks intentionally delegate to a file the implementer must read first rather than restating it: Task 6 Step 3 (`use-location-permission.ts` as the template) and Task 12 Step 3 (`plan.ts`'s session types). Both name the exact file and what to mirror. Task 9 Step 1's four test bodies are described rather than written, because they must reuse the existing engine harness in `engine.test.ts`; the assertions are specified precisely.

**Type consistency.** `AltitudeReading` fields (`at`, `sensorTimestampS`, `pressureHpa`, `relativeAltitudeM`, `epoch`) are identical in Task 6's port, Task 7's `sample()`, and Task 1's column names. `ExportAltitudeSample` (Task 3) matches `AltitudeSampleRow` (Task 1) field-for-field, which is what lets `loadAltitudeSamples` return it unmapped in Task 5. `flush`'s five-parameter arity is consistent across Tasks 8, 9 and the test fake. `isFieldTestRun` is used by the same name in Tasks 9 and 12.
