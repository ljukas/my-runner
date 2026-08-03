import { elevationRollup, type AltitudeSample } from './elevation';
import { createSmootherState, smoothFix, type LocationFix } from './geo';

/** One resampled point of the summary chart. `distanceM` is the bucket's centre. */
export interface ProfilePoint {
  distanceM: number;
  /** Seconds per km over the bucket; null when the bucket carried no usable time or distance. */
  paceSecPerKm: number | null;
  /** Metres relative to the run's start; null when no altitude was recorded. */
  elevationM: number | null;
}

export const PROFILE_SAMPLE_COUNT = 120;

interface Bucket {
  meters: number;
  firstTimestamp: number;
  lastTimestamp: number;
  elevationM: number | null;
}

/**
 * Fixes → the chart's series, resampled onto a uniform distance grid.
 * Distance is folded with the SAME smoother the stored distance used (ADR 0021 §3), so the
 * chart's x extent agrees with the summary's headline figure. Inputs need not be pre-filtered:
 * `smoothFix` gates them. Returns [] when the run covered no ground.
 */
export function toRunProfile(
  fixes: readonly LocationFix[],
  bucketCount = PROFILE_SAMPLE_COUNT,
): ProfilePoint[] {
  if (fixes.length === 0) return [];

  const elevation = elevationRollup(
    fixes.map<AltitudeSample>((fix) => ({ timestamp: fix.timestamp, altitudeM: fix.altitude })),
  );

  let state = createSmootherState();
  let cumulative = 0;
  const walked = fixes.map((fix, index) => {
    const step = smoothFix(state, fix);
    state = step.state;
    cumulative += step.acceptedDeltaMeters;
    return {
      distanceM: cumulative,
      timestamp: fix.timestamp,
      elevationM: elevation.seriesM[index],
    };
  });

  const total = cumulative;
  if (total <= 0) return [];

  const width = total / bucketCount;
  const buckets = new Map<number, Bucket>();

  for (let i = 0; i < walked.length; i += 1) {
    const point = walked[i];
    // why clamp: the final fix sits exactly on `total` and would otherwise open a
    // bucketCount-th bucket holding a single fix and therefore no measurable pace.
    const index = Math.min(bucketCount - 1, Math.floor(point.distanceM / width));
    const existing = buckets.get(index);
    const meters = i === 0 ? 0 : point.distanceM - walked[i - 1].distanceM;

    if (existing === undefined) {
      buckets.set(index, {
        meters,
        firstTimestamp: point.timestamp,
        lastTimestamp: point.timestamp,
        elevationM: point.elevationM,
      });
      continue;
    }

    existing.meters += meters;
    existing.lastTimestamp = point.timestamp;
    if (point.elevationM !== null) existing.elevationM = point.elevationM;
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, bucket]) => {
      const seconds = (bucket.lastTimestamp - bucket.firstTimestamp) / 1000;
      return {
        distanceM: (index + 0.5) * width,
        paceSecPerKm: bucket.meters > 0 && seconds > 0 ? (seconds / bucket.meters) * 1000 : null,
        elevationM: bucket.elevationM,
      };
    });
}
