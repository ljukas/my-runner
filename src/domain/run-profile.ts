import { createSmootherState, MAX_GAP_S, smoothFix, type LocationFix } from './geo';
import type { TimedAltitude } from './run-altitude';

/** One resampled point of the summary chart. `distanceM` is the bucket's centre. */
export type ProfilePoint = {
  distanceM: number;
  /** Seconds per km over the bucket; null when the bucket carried no usable time or distance. */
  paceSecPerKm: number | null;
  /** Mean relative altitude of the samples taken over the bucket; null when none were. */
  elevationM: number | null;
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

interface Walked {
  distanceM: number;
  timestamp: number;
}

// why interpolated between fixes and clamped at the ends: samples arrive ~1 Hz on their own clock,
// and one taken before the first or after the last fix still belongs to where the runner stood.
function distanceAt(walked: readonly Walked[], timestamp: number, from: number): [number, number] {
  let j = from;
  while (j < walked.length && walked[j].timestamp < timestamp) j += 1;
  if (j === 0) return [walked[0].distanceM, 0];
  if (j === walked.length) return [walked[j - 1].distanceM, j];
  const a = walked[j - 1];
  const b = walked[j];
  const span = b.timestamp - a.timestamp;
  const t = span > 0 ? (timestamp - a.timestamp) / span : 1;
  return [a.distanceM + (b.distanceM - a.distanceM) * t, j];
}

// why a mean and not one interpolated value per bucket: every sample counts, and the samples of a
// stretch spent standing still pile into the bucket where the runner stood.
function elevationBuckets(
  walked: readonly Walked[],
  altitude: readonly TimedAltitude[],
  width: number,
  bucketCount: number,
): (number | null)[] {
  const sums = new Array<number>(bucketCount).fill(0);
  const counts = new Array<number>(bucketCount).fill(0);
  let cursor = 0;
  for (const sample of altitude) {
    const [distanceM, next] = distanceAt(walked, sample.timestamp, cursor);
    cursor = next;
    const bucket = bucketAt(distanceM, width, bucketCount);
    sums[bucket] += sample.relativeM;
    counts[bucket] += 1;
  }
  return sums.map((sum, index) => (counts[index] > 0 ? sum / counts[index] : null));
}

/**
 * Fixes (and optionally a Run elevation series, time-aligned) → the chart's series on one uniform
 * distance grid. Distance is folded with the SAME smoother the stored distance used (ADR 0021 §3), so
 * the chart's x extent agrees with the summary's headline figure. Inputs must already pass
 * `accuracyFilter`. Returns [] for a run that covered no ground, or a `bucketCount` that is not a
 * positive integer.
 */
export function toRunProfile(
  fixes: readonly LocationFix[],
  bucketCount = bucketCountFor(fixes.length),
  altitude: readonly TimedAltitude[] = [],
): ProfilePoint[] {
  if (fixes.length === 0) return [];
  if (!Number.isInteger(bucketCount) || bucketCount < 1) return [];

  let state = createSmootherState();
  let cumulative = 0;
  const walked: Walked[] = fixes.map((fix) => {
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
  let carried = 0;

  // Legs are split across the buckets they cross so a long one cannot step over a bucket and
  // leave it empty; both measurements behind this are in spec §5.2.
  for (let i = 1; i < walked.length; i += 1) {
    const from = walked[i - 1];
    const to = walked[i];
    const legSeconds = (to.timestamp - from.timestamp) / 1000;
    // why MAX_GAP_S clears the carry but a non-positive leg doesn't: a pause or dropout is
    // unmeasured time and must not cross into a bucket, but a duplicate/backwards timestamp
    // carries no time of its own and is not evidence the held stretch ended (pace chart
    // stationary-time design §5).
    if (legSeconds > MAX_GAP_S) {
      // the smoother's own reset threshold (ADR 0021)
      carried = 0;
      continue;
    }
    if (legSeconds <= 0) continue;

    const legMeters = to.distanceM - from.distanceM;
    if (legMeters <= 0) {
      // No distance committed yet: ride the seconds forward onto the leg that finally does,
      // rather than charging them to a bucket that earned no distance (design §5).
      carried += legSeconds;
      continue;
    }

    const legSecondsWithCarry = legSeconds + carried;
    carried = 0;
    const first = bucketAt(from.distanceM, width, bucketCount);
    const last = bucketAt(to.distanceM, width, bucketCount);
    for (let bucket = first; bucket <= last; bucket += 1) {
      const overlap =
        Math.min(to.distanceM, (bucket + 1) * width) - Math.max(from.distanceM, bucket * width);
      if (overlap <= 0) continue;
      meters[bucket] += overlap;
      seconds[bucket] += legSecondsWithCarry * (overlap / legMeters);
    }
  }

  const elevation = elevationBuckets(walked, altitude, width, bucketCount);

  return meters.map((bucketMeters, index) => ({
    distanceM: (index + 0.5) * width,
    paceSecPerKm:
      bucketMeters > 0 && seconds[index] > 0 ? (seconds[index] / bucketMeters) * 1000 : null,
    elevationM: elevation[index],
  }));
}

// why: `Line` splits at nulls and a one-point group emits a move with no lineto, so a chart can
// otherwise paint its axes around an empty canvas (spec §8).
function hasAdjacentPair(points: readonly ProfilePoint[], key: 'paceSecPerKm' | 'elevationM') {
  return points.some(
    (point, index) => index > 0 && point[key] !== null && points[index - 1][key] !== null,
  );
}

/** Whether the pace series can actually be stroked. */
export function isDrawableProfile(points: readonly ProfilePoint[]): boolean {
  return hasAdjacentPair(points, 'paceSecPerKm');
}

/** Whether the elevation series can actually be stroked. */
export function isDrawableElevation(points: readonly ProfilePoint[]): boolean {
  return hasAdjacentPair(points, 'elevationM');
}

// why a floor: a flat run's ~1 m barometer wobble would otherwise fill the plot and read as hills.
const MIN_ELEVATION_DOMAIN_SPAN_M = 10;

/** `[low, high]` for the elevation axis: the series' own extent, widened upward to at least
 *  `MIN_ELEVATION_DOMAIN_SPAN_M`. Undefined unless `isDrawableElevation`. */
export function elevationChartDomain(
  points: readonly ProfilePoint[],
): [number, number] | undefined {
  if (!isDrawableElevation(points)) return undefined;
  const values = points
    .map((point) => point.elevationM)
    .filter((value): value is number => value !== null);

  const low = Math.min(...values);
  const high = Math.max(...values);
  // why upward only: centring put a tick below the lowest point the runner ever reached, which
  // reads as a fault in a series relative to where the run began.
  return [low, Math.max(high, low + MIN_ELEVATION_DOMAIN_SPAN_M)];
}

function percentile(sortedAscending: readonly number[], p: number): number {
  const index = Math.ceil((sortedAscending.length - 1) * p);
  return sortedAscending[Math.min(sortedAscending.length - 1, index)];
}

// why a fraction of `fast`, not a fixed number of seconds: pace spans ~150-4000 s/km across
// users, so a constant floor would be invisible at one end and disproportionate at the other.
const MIN_PACE_DOMAIN_SPAN_FRACTION = 0.1;

/** `[slow, fast]` pace domain for the chart's y axis: `fast` is the minimum pace, `slow` its 95th
 * percentile widened to a minimum span, so a uniform series can't collapse it to zero width. */
export function paceChartDomain(points: readonly ProfilePoint[]): [number, number] | undefined {
  const paces = points
    .map((point) => point.paceSecPerKm)
    .filter((pace): pace is number => pace !== null)
    .sort((a, b) => a - b);
  if (paces.length === 0) return undefined;

  const fast = paces[0];
  const slow = Math.max(percentile(paces, 0.95), fast + fast * MIN_PACE_DOMAIN_SPAN_FRACTION);
  return [slow, fast];
}

export interface ProfilePaceRange {
  fastestSecPerKm: number;
  slowestSecPerKm: number;
  /** Points strictly slower than `slowestSecPerKm`. */
  clippedCount: number;
  /** The clipped points' own slowest pace; null when `clippedCount` is 0. */
  clippedSlowestSecPerKm: number | null;
}

/**
 * The pace axis's extent, for the card's VoiceOver label — `paceChartDomain`'s bound, not the
 * series' own min/max, so the label never names a number the axis doesn't show (design §8.1).
 * Null when nothing measured.
 *
 * why only a range, and no characterisation of the run: bucket means cannot support one here.
 * A C25K session puts the same run/walk mix in both halves by construction, so a first-half /
 * second-half comparison reported "steady" for every session in the program — including a W1D1
 * alternating eight times between 5:43 and 11:55 /km.
 */
export function paceRange(points: readonly ProfilePoint[]): ProfilePaceRange | null {
  const domain = paceChartDomain(points);
  if (!domain) return null;
  const [slowestSecPerKm, fastestSecPerKm] = domain;

  const clipped = points
    .map((point) => point.paceSecPerKm)
    .filter((pace): pace is number => pace !== null && pace > slowestSecPerKm);

  return {
    fastestSecPerKm,
    slowestSecPerKm,
    clippedCount: clipped.length,
    clippedSlowestSecPerKm: clipped.length > 0 ? Math.max(...clipped) : null,
  };
}
