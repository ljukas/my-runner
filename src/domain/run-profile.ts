import {
  createSmootherState,
  MAX_GAP_S,
  NEAR_STATIONARY_DEADBAND_M,
  NEAR_STATIONARY_SPEED_MPS,
  smoothFix,
  type LocationFix,
} from './geo';

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

// why derived and not chosen: the longest the smoother's deadband can legitimately hold distance
// for a runner still moving at the measurable floor. A tuned speed threshold here deleted the
// chart outright for slow walkers — see the slice design §16.
const ACCRUAL_GUARD_S = NEAR_STATIONARY_DEADBAND_M / NEAR_STATIONARY_SPEED_MPS;

interface Leg {
  fromM: number;
  toM: number;
  seconds: number;
  committedM: number;
  /** False for a gap or a non-monotonic timestamp: unmeasured, which is not the same as stopped. */
  measured: boolean;
}

function legsOf(fixes: readonly LocationFix[]): { legs: Leg[]; total: number } {
  let state = createSmootherState();
  let cumulative = 0;
  const walked = fixes.map((fix) => {
    const step = smoothFix(state, fix);
    state = step.state;
    cumulative += step.acceptedDeltaMeters;
    return {
      distanceM: cumulative,
      timestamp: fix.timestamp,
      committedM: step.acceptedDeltaMeters,
    };
  });

  const legs: Leg[] = [];
  for (let i = 1; i < walked.length; i += 1) {
    const seconds = (walked[i].timestamp - walked[i - 1].timestamp) / 1000;
    legs.push({
      fromM: walked[i - 1].distanceM,
      toM: walked[i].distanceM,
      seconds,
      committedM: walked[i].committedM,
      measured: seconds > 0 && seconds <= MAX_GAP_S,
    });
  }
  return { legs, total: cumulative };
}

/**
 * Which legs fall inside a stop: a run of measured legs that committed nothing, lasting longer
 * than the deadband could legitimately hold. A shorter run is accrual, and its time is carried
 * rather than dropped (`toRunProfile`).
 */
function stoppedLegs(legs: readonly Leg[]): boolean[] {
  const stopped = new Array<boolean>(legs.length).fill(false);
  let index = 0;
  while (index < legs.length) {
    if (!legs[index].measured || legs[index].committedM > 0) {
      index += 1;
      continue;
    }
    let end = index;
    let seconds = 0;
    while (end < legs.length && legs[end].measured && legs[end].committedM === 0) {
      seconds += legs[end].seconds;
      end += 1;
    }
    if (seconds > ACCRUAL_GUARD_S) for (let i = index; i < end; i += 1) stopped[i] = true;
    index = end;
  }
  return stopped;
}

/** Seconds the pace fold discarded as standstill, for the card to disclose. 0 when the runner never stopped. */
export function excludedStandstillSeconds(fixes: readonly LocationFix[]): number {
  const { legs } = legsOf(fixes);
  const stopped = stoppedLegs(legs);
  return legs.reduce((sum, leg, index) => (stopped[index] ? sum + leg.seconds : sum), 0);
}

/**
 * Fixes → the chart's pace series, resampled onto a uniform distance grid. A standstill's time is
 * excluded from the fold, per the slice design §4. Inputs must already pass `accuracyFilter`.
 * Returns [] for a run that covered no ground, or a `bucketCount` that is not a positive integer.
 */
export function toRunProfile(
  fixes: readonly LocationFix[],
  bucketCount = bucketCountFor(fixes.length),
): ProfilePoint[] {
  if (fixes.length === 0) return [];
  if (!Number.isInteger(bucketCount) || bucketCount < 1) return [];

  const { legs, total } = legsOf(fixes);
  if (total <= 0) return [];
  const stopped = stoppedLegs(legs);

  const width = total / bucketCount;
  const meters = new Array<number>(bucketCount).fill(0);
  const seconds = new Array<number>(bucketCount).fill(0);
  let heldSeconds = 0;

  // Legs are split across the buckets they cross so a long one cannot step over a bucket and
  // leave it empty; both measurements behind this are in the pace chart design §5.2.
  for (let i = 0; i < legs.length; i += 1) {
    const leg = legs[i];
    // why the reset: a gap is unmeasured time, so it cannot carry accrued seconds across itself.
    if (!leg.measured) {
      heldSeconds = 0;
      continue;
    }
    if (stopped[i]) continue;

    const legMeters = leg.toM - leg.fromM;
    if (legMeters <= 0) {
      heldSeconds += leg.seconds;
      continue;
    }

    const legSeconds = leg.seconds + heldSeconds;
    heldSeconds = 0;
    const first = bucketAt(leg.fromM, width, bucketCount);
    const last = bucketAt(leg.toM, width, bucketCount);
    for (let bucket = first; bucket <= last; bucket += 1) {
      const overlap = Math.min(leg.toM, (bucket + 1) * width) - Math.max(leg.fromM, bucket * width);
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

export interface ProfilePaceRange {
  fastestSecPerKm: number;
  slowestSecPerKm: number;
}

/**
 * The pace axis's extent, for the card's VoiceOver label; null when nothing measured.
 *
 * why only a range, and no characterisation of the run: bucket means cannot support one here.
 * A C25K session puts the same run/walk mix in both halves by construction, so a first-half /
 * second-half comparison reported "steady" for every session in the program — including a W1D1
 * alternating eight times between 5:43 and 11:55 /km.
 */
export function paceRange(points: readonly ProfilePoint[]): ProfilePaceRange | null {
  const paces = points
    .map((point) => point.paceSecPerKm)
    .filter((pace): pace is number => pace !== null);
  if (paces.length === 0) return null;

  return { fastestSecPerKm: Math.min(...paces), slowestSecPerKm: Math.max(...paces) };
}
