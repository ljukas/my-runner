#!/usr/bin/env bun
/**
 * Derives the field-capture metrics `docs/field-test-capture-protocol.md` asks for from one or more
 * run exports, and optionally writes a committable JSON summary per capture.
 *
 * Usage:
 *   bun scripts/analyze-field-capture.ts field-data/runbro-*.txt
 *   bun scripts/analyze-field-capture.ts field-data/runbro-*.txt --json docs/field-captures
 *
 * why it lives here rather than in package.json's scripts: every `scripts` entry but `android`/`ios`
 * is a native-fingerprint source (fingerprint.config.js), so adding one would invalidate the cached
 * e2e-simulator build and cost the next `e2e-refresh` a 15-20 minute rebuild for a docs-only tool.
 *
 * PRIVACY: an export holds the runner's home address in its first and last fix. Nothing here prints
 * or serialises a coordinate — only aggregates derived from them — so this output is safe to commit
 * and paste into a PR while `field-data/` stays gitignored.
 */
import { elevationRollup, type AltitudeSample, type ElevationConfig } from '@/domain/elevation';

const SUMMARY_SCHEMA = 1;

/** The grid spec §8.5 scores once captures 1 and 2 exist; `w31 h10` is the shipped GPS pair. */
const CONFIG_GRID: ElevationConfig[] = [
  { medianWindow: 1, hysteresisM: 0 },
  { medianWindow: 5, hysteresisM: 1 },
  { medianWindow: 15, hysteresisM: 3 },
  { medianWindow: 31, hysteresisM: 3 },
  { medianWindow: 31, hysteresisM: 10 },
  { medianWindow: 61, hysteresisM: 3 },
  { medianWindow: 61, hysteresisM: 30 },
  { medianWindow: 121, hysteresisM: 60 },
];

interface Section {
  columns: string[];
  rows: Record<string, string>[];
}

interface Export {
  header: {
    schema: number;
    exportedAt: string;
    run: Record<string, string | number | null>;
    device: Record<string, string | number | boolean | null>;
    counts: Record<string, number>;
    dropped: number;
  };
  sections: Record<string, Section>;
  trailerTotal: number | null;
}

/** Mirrors `csv()` in src/domain/run-export.ts: quote only when needed, `"` doubled inside. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(field);
      field = '';
    } else field += c;
  }
  out.push(field);
  return out;
}

function parseExport(text: string, path: string): Export {
  const lines = text.split('\n');
  if (!lines[0]?.startsWith('# runbro-export/')) throw new Error(`${path}: missing magic line`);
  const header = JSON.parse(lines[1] ?? '') as Export['header'];

  const sections: Record<string, Section> = {};
  let current: Section | null = null;
  let trailerTotal: number | null = null;

  for (const line of lines.slice(2)) {
    if (line.startsWith('## ')) {
      current = { columns: [], rows: [] };
      sections[line.slice(3).trim()] = current;
      continue;
    }
    if (line.startsWith('# end')) {
      trailerTotal = Number(line.slice(5).trim());
      continue;
    }
    if (!line.trim() || !current) continue;
    if (current.columns.length === 0) {
      current.columns = splitCsv(line);
      continue;
    }
    const values = splitCsv(line);
    current.rows.push(Object.fromEntries(current.columns.map((c, i) => [c, values[i] ?? ''])));
  }
  return { header, sections, trailerTotal };
}

const ms = (iso: string) => Date.parse(iso);
const numOrNull = (v: string) => (v === '' ? null : Number(v));
const finite = (xs: (number | null)[]) =>
  xs.filter((x): x is number => x !== null && Number.isFinite(x));

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const k = (sorted.length - 1) * p;
  const lo = Math.floor(k);
  const hi = Math.ceil(k);
  return lo === hi ? sorted[lo]! : sorted[lo]! * (hi - k) + sorted[hi]! * (k - lo);
}

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return {
    n: xs.length,
    min: s[0]!,
    max: s[s.length - 1]!,
    mean,
    sd,
    p05: quantile(s, 0.05),
    median: quantile(s, 0.5),
    p95: quantile(s, 0.95),
  };
}

const diffs = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]!);

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function parseDetail(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function analyze(path: string, text: string, declaredZeroTruth = false) {
  const { header, sections, trailerTotal } = parseExport(text, path);
  const runStart = ms(String(header.run.startedAt));
  const runEnd = ms(String(header.run.endedAt));
  const wallS = (runEnd - runStart) / 1000;

  const alt = sections.altitude?.rows ?? [];
  const pts = sections.points?.rows ?? [];
  const log = sections.log?.rows ?? [];

  const at = alt.map((r) => ms(r.at!));
  const sensor = alt.map((r) => numOrNull(r.sensorTimestampS!));
  const press = alt.map((r) => Number(r.pressureHpa));
  const rel = alt.map((r) => numOrNull(r.relativeAltitudeM!));
  const relOk = finite(rel);

  // --- cadence, both clocks (spec §4.1: one clock cannot separate a sensor gap from a JS stall) ---
  const dAt = diffs(at).map((d) => d / 1000);
  const sensorOk = finite(sensor);
  const dSensor = diffs(sensorOk);
  const cadence = alt.length > 1 ? stats(dAt) : null;
  const sensorCadence = sensorOk.length > 1 ? stats(dSensor) : null;

  const gapThresholds = [2, 5, 10, 30, 60];
  const gaps = Object.fromEntries(
    gapThresholds.map((t) => [`gt${t}s`, dAt.filter((d) => d > t).length]),
  );
  const coverageS = alt.length > 1 ? (at[at.length - 1]! - at[0]!) / 1000 : 0;

  // Clock skew: `at` is Date.now(), sensorTimestampS is CMLogItem's boot clock. Independent rates.
  const offsets = alt.map((_, i) => (sensor[i] === null ? null : at[i]! / 1000 - sensor[i]!));
  const offOk = finite(offsets);
  const clockDriftMs = offOk.length > 1 ? (offOk[offOk.length - 1]! - offOk[0]!) * 1000 : null;

  // --- sensor noise: 2nd difference isolates the white component; var(d2) = 6*sigma^2 ---
  const d2 = relOk.slice(2).map((v, i) => v - 2 * relOk[i + 1]! + relOk[i]!);
  const sigmaM = d2.length > 2 ? stats(d2).sd / Math.sqrt(6) : null;
  const pressureSteps = diffs(press)
    .map(Math.abs)
    .filter((d) => d > 0);

  // --- rebase: a relAlt discontinuity across a CONTINUOUS pressure reading (ADR 0015, 2026-08-04) ---
  const relSteps = diffs(relOk).map(Math.abs);
  const jumps = relOk
    .slice(1)
    .map((v, i) => ({ i: i + 1, dRel: v - relOk[i]!, dPress: press[i + 1]! - press[i]! }))
    .filter((j) => Math.abs(j.dRel) > 1);
  const rebases = jumps.filter((j) => Math.abs(j.dPress) < 0.05);
  // relAlt should track -dP/0.12 hPa-per-metre; a rebase breaks this, nothing else does.
  const consistency = relOk.map((v, i) =>
    Math.abs(v - relOk[0]! - -((press[i]! - press[0]!) / 0.12)),
  );

  // --- lifecycle: the ADR 0015 item 7 question ---
  const lifecycle = log
    .filter((r) => r.kind === 'lifecycle')
    .map((r) => ({
      t: (ms(r.at!) - runStart) / 1000,
      state: String(parseDetail(r.detailJson!)?.state ?? ''),
    }));
  const bgWindows: { fromS: number; toS: number }[] = [];
  let state = 'active';
  let bgStart = 0;
  for (const l of lifecycle) {
    if (l.state === 'background' && state !== 'background') bgStart = l.t;
    if (state === 'background' && l.state !== 'background')
      bgWindows.push({ fromS: bgStart, toS: l.t });
    state = l.state;
  }
  if (state === 'background') bgWindows.push({ fromS: bgStart, toS: wallS });
  const bgS = bgWindows.reduce((a, w) => a + (w.toS - w.fromS), 0);
  const bgSamples = bgWindows.reduce(
    (a, w) =>
      a +
      at.filter((t) => (t - runStart) / 1000 >= w.fromS && (t - runStart) / 1000 <= w.toS).length,
    0,
  );
  const nominal = cadence ? bgS / cadence.median : 0;

  // --- GPS-derived: closure, accuracy regime, stationary windows ---
  const coords = pts.map((r) => [Number(r.lat), Number(r.lng)] as [number, number]);
  const pAt = pts.map((r) => ms(r.at!));
  const altAcc = finite(pts.map((r) => numOrNull(r.altitudeAccuracyM!)));
  const speeds = finite(pts.map((r) => numOrNull(r.speedMps!)));
  const bracket = Math.min(60, Math.floor(relOk.length / 10) || 1);
  const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  // why displacement and not speedMps: CoreLocation reports a negative speed for "unknown", so a
  // still sample reading -1 would be classified as moving and the bracket lost (protocol, §Reading).
  const stationary: { fromS: number; toS: number; durationS: number }[] = [];
  for (let i = 0; i < coords.length;) {
    let j = i;
    while (j + 1 < coords.length && haversineM(coords[i]!, coords[j + 1]!) < 8) j += 1;
    const durationS = (pAt[j]! - pAt[i]!) / 1000;
    if (durationS >= 60)
      stationary.push({
        fromS: (pAt[i]! - runStart) / 1000,
        toS: (pAt[j]! - runStart) / 1000,
        durationS,
      });
    i = j > i ? j + 1 : i + 1;
  }

  // Capture 1 is a *certain* zero — the phone does not move at all — so every metre the reducer
  // banks on it is phantom, the one term that punishes under-smoothing (spec §8.5).
  //
  // why `--zero-truth` must be declarable, with detection only as a fallback: capture 1 of
  // 2026-08-07 sat on a desk for 54 minutes and still recorded 858 m of distance and 11.1 m of
  // displacement, because indoor GPS wanders (its altitudeAccuracy median was 18.9 m against 3.0 m
  // outdoors). GPS cannot testify that a phone was stationary; only the operator can.
  const maxDisplacementM = coords.length
    ? Math.max(...coords.map((c) => haversineM(coords[0]!, c)))
    : null;
  // why declared and NEVER inferred: auto-detection was tried and failed in both directions on the
  // first two real captures. Capture 1 sat on a desk yet accumulated 858 m of indoor GPS jitter, so
  // distance said "moving"; capture 2 was a stairwell, which is horizontally stationary inside a
  // 10.4 m radius, so displacement said "still" about the most vertically active capture taken.
  // GPS geometry cannot see the vertical axis this whole exercise is about. Only the operator knows.
  const isZeroTruth = declaredZeroTruth;

  // Drift only means anything against a known-flat truth; on a moving capture a "linear trend" is
  // just terrain, so this block is gated on the zero-truth claim.
  //
  // The split matters more than either half: median filtering attacks *white* noise, and this
  // sensor has almost none, while what actually corrupts a total is slow wander plus synoptic
  // drift, which no median window can touch. `medianFilterGain` measures exactly that.
  let drift = null;
  if (isZeroTruth && relOk.length > 10) {
    const secs = relOk.map((_, i) => (at[i]! - runStart) / 1000);
    const mx = secs.reduce((a, b) => a + b, 0) / secs.length;
    const my = relOk.reduce((a, b) => a + b, 0) / relOk.length;
    const slope =
      secs.reduce((acc, x, i) => acc + (x - mx) * (relOk[i]! - my), 0) /
      secs.reduce((acc, x) => acc + (x - mx) ** 2, 0);
    const residual = relOk.map((y, i) => y - (my + slope * (secs[i]! - mx)));
    const medianOf = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const bins: number[] = [];
    for (let m = 0; (m + 5) * 60 <= secs[secs.length - 1]!; m += 5) {
      const seg = relOk.filter((_, i) => secs[i]! >= m * 60 && secs[i]! < (m + 5) * 60);
      if (seg.length) bins.push(seg.reduce((a, b) => a + b, 0) / seg.length);
    }
    const steps = bins.slice(1).map((v, i) => v - bins[i]!);
    drift = {
      linearMPerHour: slope * 3600,
      pressureHpaPerHour: -slope * 3600 * 0.12,
      totalM: slope * (secs[secs.length - 1]! - secs[0]!),
      monotoneBins: { steps: steps.length, falling: steps.filter((d) => d < 0).length },
      residualSdM: stats(residual).sd,
      residualP2pM: Math.max(...residual) - Math.min(...residual),
      medianFilterGain: [1, 5, 15, 31, 61, 121].map((w) => {
        const sm: number[] = [];
        for (let i = w - 1; i < residual.length; i += 1) {
          sm.push(medianOf(residual.slice(i + 1 - w, i + 1)));
        }
        return { window: w, residualSdM: sm.length ? stats(sm).sd : null };
      }),
    };
  }

  // --- the shipped reducer over this capture (descriptive only without ground truth, spec §8.5) ---
  const samples: AltitudeSample[] = alt.map((r, i) => ({ timestamp: at[i]!, altitudeM: rel[i] }));
  const grid = CONFIG_GRID.map((config) => {
    const { gainM, lossM } = elevationRollup(samples, config);
    return {
      medianWindow: config.medianWindow,
      hysteresisM: config.hysteresisM,
      windowSpanS: cadence ? config.medianWindow * cadence.median : null,
      gainM,
      lossM,
      netM: gainM - lossM,
    };
  });

  const kinds: Record<string, number> = {};
  for (const r of log) kinds[r.kind!] = (kinds[r.kind!] ?? 0) + 1;
  const sensorRow = parseDetail(log.find((r) => r.kind === 'sensor')?.detailJson ?? '');
  const pedometer = parseDetail(log.find((r) => r.kind === 'pedometer')?.detailJson ?? '');
  const ticks = log.filter((r) => r.kind === 'tick').map((r) => ms(r.at!) / 1000);

  return {
    schema: SUMMARY_SCHEMA,
    file: path.split('/').pop(),
    run: {
      id: String(header.run.id).slice(0, 8),
      sessionKey: header.run.sessionKey,
      startedAt: header.run.startedAt,
      wallS,
      activeDurationS: header.run.activeDurationS,
      distanceM: header.run.distanceM,
      isFieldTestMode: header.run.sessionKey === 'field-test',
    },
    device: header.device,
    counts: header.counts,
    dropped: header.dropped,
    complete:
      trailerTotal !== null &&
      trailerTotal === Object.values(header.counts).reduce((a, b) => a + b, 0),
    altitude: {
      n: alt.length,
      nullRelative: rel.length - relOk.length,
      coverageS,
      coveragePct: wallS > 0 ? (100 * coverageS) / wallS : 0,
      firstOffsetS: alt.length ? (at[0]! - runStart) / 1000 : null,
      epochs: [...new Set(alt.map((r) => Number(r.epoch)))],
      seqGaps: alt.length
        ? Number(alt[alt.length - 1]!.seq) - Number(alt[0]!.seq) + 1 - alt.length
        : 0,
      cadenceS: cadence,
      sensorCadenceS: sensorCadence,
      impliedHz: cadence ? 1 / cadence.median : null,
      gaps,
      clockDriftMs,
      relativeAltitudeSpanM: relOk.length ? Math.max(...relOk) - Math.min(...relOk) : null,
      pressureSpanHpa: press.length ? Math.max(...press) - Math.min(...press) : null,
      pressureQuantumHpa: pressureSteps.length ? Math.min(...pressureSteps) : null,
      noiseSigmaM: sigmaM,
      maxRelativeStepM: relSteps.length ? Math.max(...relSteps) : null,
      rebaseCount: rebases.length,
      relativeJumpCount: jumps.length,
      pressureRelativeMaxDeviationM: consistency.length ? Math.max(...consistency) : null,
    },
    background: {
      windowCount: bgWindows.length,
      totalS: bgS,
      pctOfRun: wallS > 0 ? (100 * bgS) / wallS : 0,
      samples: bgSamples,
      expectedSamples: Math.round(nominal),
      deliveryPct: nominal > 0 ? (100 * bgSamples) / nominal : null,
      windows: bgWindows,
    },
    closure: {
      startEndDisplacementM:
        coords.length > 1 ? haversineM(coords[0]!, coords[coords.length - 1]!) : null,
      firstToLastM: relOk.length ? relOk[relOk.length - 1]! - relOk[0]! : null,
      bracketMeanM: relOk.length
        ? meanOf(relOk.slice(-bracket)) - meanOf(relOk.slice(0, bracket))
        : null,
      bracketSamples: bracket,
      maxDisplacementM,
      drift,
      /** True when ground truth is a certain 0 m gain / 0 m loss — capture 1. */
      isZeroTruth,
    },
    gps: {
      n: pts.length,
      altitudeAccuracyM: altAcc.length ? stats(altAcc) : null,
      invalidAltitudeAccuracy: pts.length - altAcc.filter((a) => a > 0).length,
      negativeSpeedCount: speeds.filter((s) => s < 0).length,
    },
    stationaryWindows: stationary,
    log: {
      kinds,
      sensor: sensorRow,
      steps: pedometer?.steps ?? null,
      tickMedianS: ticks.length > 1 ? stats(diffs(ticks)).median : null,
      tickMaxS: ticks.length > 1 ? stats(diffs(ticks)).max : null,
    },
    reducerGrid: grid,
  };
}

type Summary = ReturnType<typeof analyze>;

const f = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(d);

function report(s: Summary): void {
  const a = s.altitude;
  console.log('='.repeat(78));
  console.log(
    `${s.file}   session=${s.run.sessionKey}${s.run.isFieldTestMode ? '  [FIELD TEST]' : '  [plan session — not a protocol capture]'}`,
  );
  console.log('='.repeat(78));
  console.log(
    `run      ${s.run.startedAt}  wall=${f(s.run.wallS, 0)}s (${f(s.run.wallS / 60, 1)} min)  ` +
      `distance=${f(Number(s.run.distanceM), 0)}m  complete=${s.complete}`,
  );
  console.log(
    `device   iOS ${s.device.osVersion}  app ${s.device.appVersion}  motion=${s.device.motionPermission}  ` +
      `sensor=${JSON.stringify(s.log.sensor)}`,
  );
  console.log(`counts   ${JSON.stringify(s.counts)}  dropped=${s.dropped}`);

  console.log(`\nCADENCE  (the spec §8.6 gating deliverable)`);
  console.log(
    `  receipt  median=${f(a.cadenceS?.median, 3)}s  p05=${f(a.cadenceS?.p05, 3)}  p95=${f(a.cadenceS?.p95, 3)}  ` +
      `min=${f(a.cadenceS?.min, 3)}  max=${f(a.cadenceS?.max, 3)}  -> ${f(a.impliedHz, 2)} Hz`,
  );
  console.log(
    `  sensor   median=${f(a.sensorCadenceS?.median, 3)}s   clock drift vs wall = ${f(a.clockDriftMs, 0)} ms`,
  );
  console.log(`  coverage ${f(a.coveragePct, 1)}% of wall clock   gaps ${JSON.stringify(a.gaps)}`);
  console.log(
    `  seq gaps=${a.seqGaps}  epochs=${JSON.stringify(a.epochs)}  null relAlt=${a.nullRelative}`,
  );

  console.log(`\nBACKGROUND DELIVERY  (ADR 0015 item 7)`);
  if (s.background.windowCount === 0)
    console.log('  never backgrounded — this capture cannot answer item 7');
  else {
    console.log(
      `  ${s.background.windowCount} windows, ${f(s.background.totalS, 0)}s (${f(s.background.pctOfRun, 1)}% of run)  ` +
        `samples=${s.background.samples} expected=${s.background.expectedSamples}  ` +
        `-> ${f(s.background.deliveryPct, 1)}% of nominal cadence`,
    );
  }

  console.log(`\nSENSOR`);
  console.log(
    `  noise sigma=${f(a.noiseSigmaM, 4)} m   pressure quantum=${f(a.pressureQuantumHpa, 5)} hPa   ` +
      `relAlt span=${f(a.relativeAltitudeSpanM)} m`,
  );
  console.log(
    `  rebases=${a.rebaseCount} (relAlt jumps>1m: ${a.relativeJumpCount})   ` +
      `pressure<->relAlt max deviation=${f(a.pressureRelativeMaxDeviationM)} m`,
  );

  console.log(`\nCLOSURE / GROUND TRUTH`);
  console.log(
    `  start->end GPS displacement=${f(s.closure.startEndDisplacementM, 1)} m   ` +
      `barometric closure=${f(s.closure.bracketMeanM)} m (mean of ${s.closure.bracketSamples} samples each end)`,
  );
  if (s.closure.isZeroTruth) {
    console.log(
      `  ZERO-TRUTH capture: ` +
        (s.closure.maxDisplacementM === null
          ? `no GPS points at all, recorded distance ${f(Number(s.run.distanceM), 0)} m`
          : `never left a ${f(s.closure.maxDisplacementM, 1)} m radius`) +
        `. Ground truth is 0.00 m gain, 0.00 m loss.`,
    );
  } else {
    console.log(
      `  stationary windows >=60s: ${s.stationaryWindows.length}` +
        (s.stationaryWindows.length
          ? ` -> ${s.stationaryWindows.map((w) => `t+${f(w.fromS, 0)}..${f(w.toS, 0)}s`).join(', ')}`
          : '  (no doorstep brackets — drift is not separable)'),
    );
  }
  console.log(
    `  GPS altitudeAccuracy median=${f(s.gps.altitudeAccuracyM?.median)} p95=${f(s.gps.altitudeAccuracyM?.p95)} m  ` +
      `invalid=${s.gps.invalidAltitudeAccuracy}`,
  );

  const d = s.closure.drift;
  if (d) {
    console.log(`\nDRIFT  (zero-truth capture: all of this is the atmosphere, not the terrain)`);
    console.log(
      `  linear ${f(d.linearMPerHour)} m/hour (= ${f(d.pressureHpaPerHour, 3)} hPa/hour), ` +
        `total ${f(d.totalM)} m over the capture`,
    );
    console.log(
      `  monotone: ${d.monotoneBins.falling}/${d.monotoneBins.steps} five-minute bins fall ` +
        `-> ${d.monotoneBins.falling === d.monotoneBins.steps ? 'a steady synoptic trend, not sensor wander' : 'mixed'}`,
    );
    console.log(
      `  after detrending: residual sd=${f(d.residualSdM, 4)} m  p2p=${f(d.residualP2pM, 3)} m  ` +
        `(white-noise sigma is ${f(s.altitude.noiseSigmaM, 4)} m)`,
    );
    console.log(`  what a median window actually removes:`);
    for (const g of d.medianFilterGain) {
      const base = d.medianFilterGain[0]?.residualSdM ?? null;
      const pct = base && g.residualSdM ? (100 * (base - g.residualSdM)) / base : 0;
      console.log(
        `    w${String(g.window).padEnd(4)} (${f(g.window * (s.altitude.cadenceS?.median ?? 0), 1).padStart(5)}s) ` +
          `-> residual sd=${f(g.residualSdM, 4)} m   ${pct >= 0 ? '-' : '+'}${f(Math.abs(pct), 1)}% vs unfiltered`,
      );
    }
  }

  if (s.closure.isZeroTruth) {
    console.log(`\nPHANTOM GAIN  (ground truth is 0.00 — every metre below is fabricated)`);
    console.log(`      config |  window | phantom | phantom |   |g-l|`);
  } else {
    console.log(`\nREDUCER GRID  (descriptive — NOT a score without captures 1 and 2)`);
    console.log(`      config |  window |    gain |    loss |   |g-l|`);
  }
  for (const g of s.reducerGrid) {
    const label = `w${g.medianWindow} h${g.hysteresisM}`;
    console.log(
      `  ${label.padStart(10)} | ${f(g.windowSpanS, 1).padStart(6)}s | ${f(g.gainM).padStart(7)} | ` +
        `${f(g.lossM).padStart(7)} | ${f(Math.abs(g.netM)).padStart(7)}`,
    );
  }
  console.log();
}

/**
 * Captures 3 and 4 are the same route on different days, and their whole purpose is a repeatability
 * estimate. Binning both into shared ~25 m cells and differencing the barometric altitude at each
 * gives one: real terrain is common to both, so what is left is drift plus sensor error.
 *
 * Emits aggregates only — a cell key is a position, so nothing per-cell is ever printed.
 */
function compare(aPath: string, aText: string, bPath: string, bText: string): void {
  const CELL_M = 25;

  const load = (text: string, path: string) => {
    const { sections } = parseExport(text, path);
    const pts = (sections.points?.rows ?? []).map((r) => ({
      t: ms(r.at!),
      lat: Number(r.lat),
      lng: Number(r.lng),
    }));
    const alt = (sections.altitude?.rows ?? []).map((r) => ({
      t: ms(r.at!),
      rel: numOrNull(r.relativeAltitudeM!),
    }));
    const cells = new Map<string, { rel: number; frac: number }[]>();
    const t0 = alt[0]?.t ?? 0;
    const span = (alt[alt.length - 1]?.t ?? 0) - t0;
    let j = 0;
    for (const s of alt) {
      if (s.rel === null) continue;
      while (j + 1 < pts.length && Math.abs(pts[j + 1]!.t - s.t) <= Math.abs(pts[j]!.t - s.t))
        j += 1;
      const p = pts[j];
      if (!p || Math.abs(p.t - s.t) > 5000) continue;
      const key = `${Math.round((p.lat * 111320) / CELL_M)}:${Math.round((p.lng * 111320 * Math.cos((p.lat * Math.PI) / 180)) / CELL_M)}`;
      const bucket = cells.get(key) ?? [];
      bucket.push({ rel: s.rel, frac: span > 0 ? (s.t - t0) / span : 0 });
      cells.set(key, bucket);
    }
    const rels = alt.map((s) => s.rel).filter((r): r is number => r !== null);
    const n = Math.min(60, Math.floor(rels.length / 10) || 1);
    const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
    return { cells, drift: mean(rels.slice(-n)) - mean(rels.slice(0, n)) };
  };

  const A = load(aText, aPath);
  const B = load(bText, bPath);
  const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;

  const raw: number[] = [];
  const corrected: number[] = [];
  const relief: number[] = [];
  for (const [key, av] of A.cells) {
    const bv = B.cells.get(key);
    if (!bv || av.length < 3 || bv.length < 3) continue;
    const aMean = mean(av.map((v) => v.rel));
    const bMean = mean(bv.map((v) => v.rel));
    raw.push(aMean - bMean);
    // why remove a linear-in-time drift first: each run's reference is its own start, so a capture
    // with 2 m of weather drift offsets every cell it visited late by ~2 m (ADR 0015, closure table).
    corrected.push(
      aMean -
        A.drift * mean(av.map((v) => v.frac)) -
        (bMean - B.drift * mean(bv.map((v) => v.frac))),
    );
    relief.push(aMean);
  }

  console.log('='.repeat(78));
  console.log(`REPEATABILITY  ${aPath.split('/').pop()}  vs  ${bPath.split('/').pop()}`);
  console.log('='.repeat(78));
  if (raw.length === 0) {
    console.log('  no shared cells with >=3 samples on both sides — these are not the same route.');
    return;
  }
  console.log(
    `  shared ${CELL_M} m cells compared: ${raw.length}   terrain relief spanned: ${f(Math.max(...relief) - Math.min(...relief))} m`,
  );
  console.log(`  estimated drift: A=${f(A.drift)} m  B=${f(B.drift)} m`);
  for (const [label, xs] of [
    ['raw            ', raw],
    ['drift-corrected', corrected],
  ] as const) {
    const s = stats(xs);
    console.log(
      `  ${label}  mean=${f(s.mean)} m  sd=${f(s.sd)} m  p05=${f(s.p05)}  p95=${f(s.p95)}  max|.|=${f(Math.max(...xs.map(Math.abs)))}`,
    );
  }
  console.log();
}

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonDir = jsonAt >= 0 ? args[jsonAt + 1] : null;
const files = args.filter((a, i) => !a.startsWith('--') && !(jsonAt >= 0 && i === jsonAt + 1));

if (files.length === 0) {
  console.error(
    'usage: bun scripts/analyze-field-capture.ts <export.txt> [...] ' +
      '[--json <outdir>] [--compare] [--zero-truth]',
  );
  console.error(
    '  --zero-truth  the phone did not move (capture 1). GPS cannot detect this indoors.',
  );
  process.exit(1);
}

if (args.includes('--compare')) {
  if (files.length !== 2) {
    console.error(
      '--compare takes exactly two exports (captures 3 and 4: same route, different day)',
    );
    process.exit(1);
  }
  compare(files[0]!, await Bun.file(files[0]!).text(), files[1]!, await Bun.file(files[1]!).text());
  process.exit(0);
}

for (const path of files) {
  const summary = analyze(path, await Bun.file(path).text(), args.includes('--zero-truth'));
  report(summary);
  if (jsonDir) {
    const name = `${String(summary.run.startedAt).slice(0, 10)}-${summary.run.sessionKey}-${summary.run.id}.json`;
    await Bun.write(`${jsonDir}/${name}`, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`  wrote ${jsonDir}/${name}`);
  }
}
