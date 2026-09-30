import { isFreeRun } from './free-run';
import type { StoredSegmentKind } from './run-motion';
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
  /** One per stopped bucket, in order, at the distance it began; duplicates are kept. */
  stopsAtM: number[];
}

type SegmentRow = { seq: number; kind: StoredSegmentKind };

/**
 * A span matching no row is `walk`, as on the route (ADR 0021 §4). A stop the GPS never saw — a
 * silence — has no span, so it sits where the span before it ended.
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
  let reachedM = 0;
  for (const segment of [...segments].sort((a, b) => a.seq - b.seq)) {
    const span = spanBySeq.get(segment.seq);
    if (segment.kind === 'stopped') stopsAtM.push(span?.fromM ?? reachedM);
    if (span) reachedM = span.toM;
  }
  return { runWalk, stopsAtM };
}

/** Metres the strip shows as running and as walking. */
export function bandDistances({ runWalk }: ProfileBands): { runM: number; walkM: number } {
  const total = (kind: ProfileBand['kind']) =>
    runWalk.filter((band) => band.kind === kind).reduce((sum, b) => sum + b.toM - b.fromM, 0);
  return { runM: total('run'), walkM: total('walk') };
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
