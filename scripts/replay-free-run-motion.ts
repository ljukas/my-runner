#!/usr/bin/env bun
/**
 * Replays the free-run classifier (ADR 0026 §3) over run exports and prints the free-run spec's §4.4
 * table: every plan run is bucketed as if it were a free run, with a threshold learned only from the
 * plan runs before it, and scored against its own script.
 *
 * Usage:
 *   bun scripts/replay-free-run-motion.ts field-data/runbro-*.txt ~/Downloads/runbro-*.txt
 *
 * why not a package.json script: see scripts/analyze-field-capture.ts — every `scripts` entry is a
 * native-fingerprint source.
 *
 * PRIVACY: prints aggregates only, never a coordinate (an export's first and last fix are the
 * runner's home).
 */
import { readFileSync } from 'node:fs';

import { accuracyFilter, type SegmentedFix } from '@/domain/geo';
import type { SegmentKind } from '@/domain/plan';
import { pausedIntervals, type LoggedRunEvent } from '@/domain/run-altitude';
import {
  labelledSpeeds,
  learnThreshold,
  MOTION,
  rollupOpenTrack,
  type MotionBucket,
} from '@/domain/run-motion';
import { bucketStats, paceSecPerKm } from '@/domain/run-stats';

import { parseExport } from './lib/run-export-file';

interface Capture {
  id: string;
  sessionKey: string;
  startMs: number;
  endMs: number;
  fixes: SegmentedFix[];
  kindBySeq: Map<number, SegmentKind>;
  segments: { kind: SegmentKind; actualDurationS: number; distanceM: number | null }[];
  events: LoggedRunEvent[];
}

const numOrNull = (v: string | undefined) => (v === undefined || v === '' ? null : Number(v));

function load(path: string): Capture {
  const { header, sections } = parseExport(readFileSync(path, 'utf8'), path);
  const segments = (sections.segments?.rows ?? []).map((r) => ({
    seq: Number(r.seq),
    kind: r.kind as SegmentKind,
    actualDurationS: Number(r.actualDurationS),
    distanceM: numOrNull(r.distanceM),
  }));
  const fixes: SegmentedFix[] = (sections.points?.rows ?? [])
    .map((r) => ({
      timestamp: Date.parse(r.at),
      lat: Number(r.lat),
      lng: Number(r.lng),
      altitude: numOrNull(r.altitudeM),
      accuracy: numOrNull(r.accuracyM),
      speed: numOrNull(r.speedMps),
      segmentSeq: Number(r.segmentSeq),
    }))
    .filter(accuracyFilter);
  return {
    id: path.match(/-([0-9a-f]{8})\.txt$/)?.[1] ?? path,
    sessionKey: String(header.run.sessionKey),
    startMs: Date.parse(String(header.run.startedAt)),
    endMs: Date.parse(String(header.run.endedAt)),
    fixes,
    kindBySeq: new Map(segments.map((s) => [s.seq, s.kind])),
    segments,
    events: (sections.events?.rows ?? []).map((r) => ({
      at: Number(r.at),
      type: r.type as LoggedRunEvent['type'],
    })),
  };
}

const bucketAt = (buckets: readonly MotionBucket[], atMs: number) =>
  buckets.findLast((b) => b.startMs < atMs) ?? buckets[0];

/** Share of walk/run-interval fixes, past each interval's first 10 s, whose bucket matches the script. */
function agreement(capture: Capture, buckets: readonly MotionBucket[]): number {
  const segmentStart = new Map<number, number>();
  let agree = 0;
  let scored = 0;
  for (const fix of capture.fixes) {
    if (!segmentStart.has(fix.segmentSeq)) segmentStart.set(fix.segmentSeq, fix.timestamp);
    const scripted = capture.kindBySeq.get(fix.segmentSeq);
    if (scripted !== 'run' && scripted !== 'walk') continue;
    if (fix.timestamp - (segmentStart.get(fix.segmentSeq) ?? 0) < MOTION.learnSkipMs) continue;
    const detected = bucketAt(buckets, fix.timestamp)?.kind === 'run' ? 'run' : 'walk';
    scored += 1;
    if (detected === scripted) agree += 1;
  }
  return agree / scored;
}

const clock = (secPerKm: number | null) =>
  secPerKm === null
    ? '—'
    : `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, '0')}`;

// why dedupe by run id: the same export often sits in both field-data/ and Downloads/, and a
// duplicate would learn its threshold from itself instead of from earlier runs.
const captures = [
  ...new Map(
    process.argv
      .slice(2)
      .map(load)
      .map((c) => [c.id, c]),
  ).values(),
].sort((a, b) => a.startMs - b.startMs);
for (const capture of captures) {
  if (capture.events.length === 0) {
    console.warn(`${capture.id}: no event log in the export, so its pauses are invisible here`);
  }
}
const plan = captures.filter((c) => /^w\d+d\d+$/.test(c.sessionKey));
const standing = captures.filter((c) => c.sessionKey === 'field-test');

console.log('| run | session | prior | T (m/s) | agreement | run pace (script → detected) |');
console.log('| --- | --- | --- | --- | --- | --- |');
const scores: number[] = [];
plan.forEach((capture, i) => {
  const prior = plan.slice(Math.max(0, i - 3), i);
  const thresholdMps = learnThreshold(prior.flatMap((p) => labelledSpeeds(p.fixes, p.kindBySeq)));
  const { buckets } = rollupOpenTrack(capture.fixes, {
    thresholdMps,
    paused: pausedIntervals(capture.events),
    startMs: capture.startMs,
    endMs: capture.endMs,
  });
  const score = agreement(capture, buckets);
  scores.push(score);
  const scriptRuns = capture.segments.filter((s) => s.kind === 'run');
  const scriptPace = paceSecPerKm(
    scriptRuns.reduce((m, s) => m + (s.distanceM ?? 0), 0),
    scriptRuns.reduce((t, s) => t + s.actualDurationS, 0),
  );
  const { runPaceSecPerKm } = bucketStats(
    buckets.map((b) => ({ kind: b.kind, actualDurationS: b.activeS, distanceM: b.distanceM })),
  );
  console.log(
    `| \`${capture.id}\` | ${capture.sessionKey} | ${prior.length} | ${thresholdMps.toFixed(2)} | ` +
      `${(100 * score).toFixed(1)}% | ${clock(scriptPace)} → ${clock(runPaceSecPerKm)} |`,
  );
});
// why the filter: an export with no scorable interval fix (a run ended in its warm-up) scores NaN.
const scored = scores.filter((s) => !Number.isNaN(s));
const mean = scored.reduce((a, b) => a + b, 0) / scored.length;
console.log(
  `\nMean held-out agreement: ${(100 * mean).toFixed(1)}% over ${scored.length} plan runs.`,
);

let stoppedS = 0;
let activeS = 0;
for (const capture of standing) {
  const { buckets } = rollupOpenTrack(capture.fixes, {
    thresholdMps: MOTION.fallbackThresholdMps,
    paused: pausedIntervals(capture.events),
    startMs: capture.startMs,
    endMs: capture.endMs,
  });
  for (const bucket of buckets) {
    activeS += bucket.activeS;
    if (bucket.kind === 'stopped') stoppedS += bucket.activeS;
  }
}
if (standing.length > 0) {
  console.log(
    `Field-test active time labelled stopped: ${((100 * stoppedS) / activeS).toFixed(1)}% over ${standing.length} captures.`,
  );
}
