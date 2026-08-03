import { createSmootherState, smoothFix, type LocationFix } from './geo';

/** One resampled point of the summary chart. `distanceM` is the bucket's centre. */
export interface ProfilePoint {
  distanceM: number;
  /** Seconds per km over the bucket; null when the bucket carried no usable time or distance. */
  paceSecPerKm: number | null;
}

/** Upper bound on the resampled point count; shorter runs get proportionally fewer. */
export const PROFILE_SAMPLE_COUNT = 120;

// why 5: 600 fixes / 120 buckets — the cap's own density; fewer thins into GPS noise (spec §5.2).
const MIN_FIXES_PER_BUCKET = 5;

function bucketCountFor(fixCount: number): number {
  return Math.max(1, Math.min(PROFILE_SAMPLE_COUNT, Math.floor(fixCount / MIN_FIXES_PER_BUCKET)));
}

interface Bucket {
  meters: number;
  /** The fix BEFORE the bucket's first one: `meters` includes the leg entering the bucket (spec §5.2). */
  entryTimestamp: number;
  lastTimestamp: number;
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
  const buckets = new Map<number, Bucket>();

  for (let i = 0; i < walked.length; i += 1) {
    const point = walked[i];
    // why clamp: the final fix sits exactly on `total`, one index past the grid's last bucket.
    const index = Math.min(bucketCount - 1, Math.floor(point.distanceM / width));
    const existing = buckets.get(index);
    const meters = i === 0 ? 0 : point.distanceM - walked[i - 1].distanceM;

    if (existing === undefined) {
      buckets.set(index, {
        meters,
        entryTimestamp: i === 0 ? point.timestamp : walked[i - 1].timestamp,
        lastTimestamp: point.timestamp,
      });
      continue;
    }

    existing.meters += meters;
    existing.lastTimestamp = point.timestamp;
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, bucket]) => {
      const seconds = (bucket.lastTimestamp - bucket.entryTimestamp) / 1000;
      return {
        distanceM: (index + 0.5) * width,
        paceSecPerKm: bucket.meters > 0 && seconds > 0 ? (seconds / bucket.meters) * 1000 : null,
      };
    });
}
