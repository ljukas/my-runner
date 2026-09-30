import { formatDistanceKm } from './format';
import { isFreeRun } from './free-run';
import { MAX_GAP_S } from './geo';
import { MOTION, type StoredSegmentKind } from './run-motion';
import type { ProfileSpan } from './run-profile';

export interface ProfileBand {
  kind: 'run' | 'walk';
  fromM: number;
  toM: number;
}

/** A free run's buckets on the pace chart's distance axis (ADR 0026 §5). */
export interface ProfileBands {
  /** Consecutive buckets of one kind merged; a stop's few metres go to the band before it, so the
   *  bands tile the axis without a gap. */
  runWalk: ProfileBand[];
  /** One per stopped bucket the GPS measured standing, in order, at the distance it began;
   *  duplicates are kept. */
  stopsAtM: number[];
  /** One per stopped bucket holding a GPS silence (owner decision: drawn apart from stops). A bucket
   *  can hold both — a stop the signal then dropped in — and is in both lists. */
  silencesAtM: number[];
}

type SegmentRow = { seq: number; kind: StoredSegmentKind; actualDurationS: number };

// why half the dwell: a confirmed stop was measured for at least the dwell, while a silence's bucket
// holds at most the one leg that closes it (measured on the free-run fixtures: ≤ 1 s against ≥ 10 s)
const MIN_MEASURED_STOP_S = MOTION.dwellMs / 1000 / 2;

/**
 * A span matching no row is `walk`, as on the route (ADR 0021 §4). A stopped bucket with no fixes at
 * all has no span and sits where the span before it ended.
 */
export function toProfileBands(
  spans: readonly ProfileSpan[],
  segments: readonly SegmentRow[],
): ProfileBands {
  const kindBySeq = new Map(segments.map((segment) => [segment.seq, segment.kind]));
  const runWalk: ProfileBand[] = [];
  for (const span of spans) {
    const kind = kindBySeq.get(span.segmentSeq) ?? 'walk';
    if (kind === 'stopped') continue;
    const band = kind === 'run' ? 'run' : 'walk';
    const last = runWalk.at(-1);
    if (last) last.toM = span.fromM;
    if (last?.kind === band) last.toM = span.toM;
    else runWalk.push({ kind: band, fromM: last?.toM ?? span.fromM, toM: span.toM });
  }

  const spanBySeq = new Map(spans.map((span) => [span.segmentSeq, span]));
  const stopsAtM: number[] = [];
  const silencesAtM: number[] = [];
  let reachedM = 0;
  for (const segment of [...segments].sort((a, b) => a.seq - b.seq)) {
    const span = spanBySeq.get(segment.seq);
    if (segment.kind === 'stopped') {
      const measuredS = span?.measuredS ?? 0;
      const atM = span?.fromM ?? reachedM;
      if (measuredS >= MIN_MEASURED_STOP_S) stopsAtM.push(atM);
      // the gap rule's own threshold (`silentSince`): shorter unmeasured time is ordinary fix spacing
      if (segment.actualDurationS - measuredS > MAX_GAP_S) silencesAtM.push(atM);
    }
    if (span) reachedM = span.toM;
  }
  return { runWalk, stopsAtM, silencesAtM };
}

const times = (count: number) => `${count} ${count === 1 ? 'time' : 'times'}`;

/** The strip and its markers in words, for the chart's accessibility label; parts that are empty
 *  are left out ("Running 0.67 km. GPS lost 1 time."). */
export function bandsLabel({ runWalk, stopsAtM, silencesAtM }: ProfileBands): string {
  const metres = (kind: ProfileBand['kind']) =>
    runWalk.filter((band) => band.kind === kind).reduce((sum, b) => sum + b.toM - b.fromM, 0);
  const runM = metres('run');
  const walkM = metres('walk');
  const parts = [
    runM > 0 && `running ${formatDistanceKm(runM)}`,
    walkM > 0 && `walking ${formatDistanceKm(walkM)}`,
    stopsAtM.length > 0 && `stopped ${times(stopsAtM.length)}`,
  ].filter(Boolean);
  const moved = parts.join(', ');
  return [
    moved && `${moved[0].toUpperCase()}${moved.slice(1)}.`,
    silencesAtM.length > 0 && `GPS lost ${times(silencesAtM.length)}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** A free run's bands; null for a plan run, whose chart stays as it was (spec §5.3). */
export function bandsFor(
  sessionKey: string,
  spans: readonly ProfileSpan[] | null,
  segments: readonly SegmentRow[],
): ProfileBands | null {
  if (!isFreeRun(sessionKey) || spans === null || spans.length === 0) return null;
  return toProfileBands(spans, segments);
}
