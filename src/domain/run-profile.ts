import { createSmootherState, MAX_GAP_S, smoothFix, type LocationFix } from './geo';

/** One resampled point of the summary chart. `distanceM` is the bucket's centre. */
export type ProfilePoint = {
  distanceM: number;
  /** Seconds per km over the bucket; null when the bucket carried no usable time or distance. */
  paceSecPerKm: number | null;
};

/** Upper bound on the resampled point count; shorter runs get proportionally fewer. */
export const PROFILE_SAMPLE_COUNT = 120;

// why 5: 600 fixes / 120 buckets — the cap's own density; fewer thins into GPS noise (spec §5.2).
const MIN_FIXES_PER_BUCKET = 5;

function bucketCountFor(fixCount: number): number {
  return Math.max(1, Math.min(PROFILE_SAMPLE_COUNT, Math.floor(fixCount / MIN_FIXES_PER_BUCKET)));
}

// why clamp: the final fix sits exactly on `total`, one index past the grid's last bucket.
function bucketAt(distanceM: number, width: number, bucketCount: number): number {
  return Math.min(bucketCount - 1, Math.max(0, Math.floor(distanceM / width)));
}

/**
 * Fixes → the chart's pace series, resampled onto a uniform distance grid. Distance is folded with
 * the SAME smoother the stored distance used (ADR 0021 §3), so the chart's x extent agrees with the
 * summary's headline figure. Inputs must already pass `accuracyFilter`. Returns [] for a run that
 * covered no ground, or a `bucketCount` that is not a positive integer.
 */
export function toRunProfile(
  fixes: readonly LocationFix[],
  bucketCount = bucketCountFor(fixes.length),
): ProfilePoint[] {
  if (fixes.length === 0) return [];
  if (!Number.isInteger(bucketCount) || bucketCount < 1) return [];

  let state = createSmootherState();
  let cumulative = 0;
  const walked = fixes.map((fix) => {
    const step = smoothFix(state, fix);
    state = step.state;
    cumulative += step.acceptedDeltaMeters;
    return { distanceM: cumulative, timestamp: fix.timestamp };
  });

  const total = cumulative;
  if (total <= 0) return [];

  const width = total / bucketCount;
  const meters = new Array<number>(bucketCount).fill(0);
  const seconds = new Array<number>(bucketCount).fill(0);

  // Legs are split across the buckets they cross so a long one cannot step over a bucket and
  // leave it empty; both measurements behind this are in spec §5.2.
  for (let i = 1; i < walked.length; i += 1) {
    const from = walked[i - 1];
    const to = walked[i];
    const legSeconds = (to.timestamp - from.timestamp) / 1000;
    // why MAX_GAP_S: a pause or dropout is a bare timestamp gap, and charging it to one bucket
    // made it an outlier the auto-fit axis scaled the whole chart to. Such a leg carries no
    // distance to lose — it is the smoother's own reset threshold.
    if (legSeconds <= 0 || legSeconds > MAX_GAP_S) continue;

    const legMeters = to.distanceM - from.distanceM;
    if (legMeters <= 0) {
      // A stationary stretch is real running time and belongs to the bucket it happened in.
      seconds[bucketAt(from.distanceM, width, bucketCount)] += legSeconds;
      continue;
    }

    const first = bucketAt(from.distanceM, width, bucketCount);
    const last = bucketAt(to.distanceM, width, bucketCount);
    for (let bucket = first; bucket <= last; bucket += 1) {
      const overlap =
        Math.min(to.distanceM, (bucket + 1) * width) - Math.max(from.distanceM, bucket * width);
      if (overlap <= 0) continue;
      meters[bucket] += overlap;
      seconds[bucket] += legSeconds * (overlap / legMeters);
    }
  }

  return meters.map((bucketMeters, index) => ({
    distanceM: (index + 0.5) * width,
    paceSecPerKm:
      bucketMeters > 0 && seconds[index] > 0 ? (seconds[index] / bucketMeters) * 1000 : null,
  }));
}

/**
 * Whether the series can actually be stroked: `Line` splits at nulls and a one-point group emits a
 * move with no lineto, so a chart can otherwise paint its axes around an empty canvas (spec §8).
 */
export function isDrawableProfile(points: readonly ProfilePoint[]): boolean {
  return points.some(
    (point, index) =>
      index > 0 && point.paceSecPerKm !== null && points[index - 1].paceSecPerKm !== null,
  );
}

export interface ProfileShape {
  fastestSecPerKm: number;
  slowestSecPerKm: number;
  trend: 'faster' | 'slower' | 'steady';
}

// why a band rather than a comparison: GPS bucket pace wanders a few percent on a genuinely even
// run, and announcing "finished slower" off 1% of noise is worse than announcing nothing.
const TREND_BAND = 0.05;

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The shape a sighted reader gets for free, for the card's VoiceOver label; null when nothing measured. */
export function describeProfile(points: readonly ProfilePoint[]): ProfileShape | null {
  const paces = points
    .map((point) => point.paceSecPerKm)
    .filter((pace): pace is number => pace !== null);
  if (paces.length === 0) return null;

  const half = Math.floor(paces.length / 2);
  const opening = half > 0 ? mean(paces.slice(0, half)) : 0;
  const closing = half > 0 ? mean(paces.slice(paces.length - half)) : 0;

  let trend: ProfileShape['trend'] = 'steady';
  if (half > 0 && closing < opening * (1 - TREND_BAND)) trend = 'faster';
  if (half > 0 && closing > opening * (1 + TREND_BAND)) trend = 'slower';

  return {
    fastestSecPerKm: Math.min(...paces),
    slowestSecPerKm: Math.max(...paces),
    trend,
  };
}
