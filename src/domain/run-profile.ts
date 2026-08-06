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

// why a rate, not the hold's duration: geo.ts:332 only releases the deadband above 0.5 m/s, so the
// hold needs MORE than NEAR_STATIONARY_DEADBAND_M / NEAR_STATIONARY_SPEED_MPS (3 s) to clear it —
// that figure is a LOWER bound on legitimate accrual, not an upper one (spec §5).
export const STANDSTILL_RATE_MPS = NEAR_STATIONARY_SPEED_MPS / 2;

type LegKind = 'moved' | 'held' | 'gated' | 'gap' | 'untimed';

interface Leg {
  fromM: number;
  toM: number;
  seconds: number;
  committedM: number;
  kind: LegKind;
}

function classifyLeg(
  seconds: number,
  committedM: number,
  gated: boolean,
  restarted: boolean,
): LegKind {
  if (seconds <= 0) return 'untimed'; // duplicate or backwards timestamp
  if (seconds > MAX_GAP_S || restarted) return 'gap';
  if (committedM > 0) return 'moved';
  return gated ? 'gated' : 'held';
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
      gated: step.smoothedPoint === null,
      restarted: step.restarted,
    };
  });

  const legs: Leg[] = [];
  for (let i = 1; i < walked.length; i += 1) {
    const from = walked[i - 1];
    const to = walked[i];
    const seconds = (to.timestamp - from.timestamp) / 1000;
    legs.push({
      fromM: from.distanceM,
      toM: to.distanceM,
      seconds,
      committedM: to.committedM,
      kind: classifyLeg(seconds, to.committedM, to.gated, to.restarted),
    });
  }
  return { legs, total: cumulative };
}

// why untimed legs are transparent below: a duplicate/backwards timestamp carries no time and no
// distance, so it is not evidence the hold ended — treating it as a terminator made every
// accrual run look like it never released (spec §5, §16).
function stoppedLegs(legs: readonly Leg[]): boolean[] {
  const stopped = new Array<boolean>(legs.length).fill(false);
  let index = 0;
  while (index < legs.length) {
    if (legs[index].kind !== 'held') {
      index += 1;
      continue;
    }
    let end = index;
    let seconds = 0;
    while (end < legs.length && (legs[end].kind === 'held' || legs[end].kind === 'untimed')) {
      seconds += legs[end].seconds;
      end += 1;
    }
    const releasing = end < legs.length && legs[end].kind === 'moved' ? legs[end] : null;
    // why a margin and not merely "at the start": a slow walker's very first hold run IS leg 0 —
    // the deadband warming up — and excluding it disclosed standing on a run with none. A stand is
    // distinguishable there by what releases it: someone who stood then set off covers far more
    // than a deadband flush (21.8 m measured on a real 17 s head), where accrual releases ~1.5 m.
    const standingStart =
      index === 0 && releasing !== null && releasing.committedM > 2 * NEAR_STATIONARY_DEADBAND_M;
    // why a null release is not a stop: the track simply ended mid-hold, so there is no evidence
    // either way. Its seconds reach no bucket regardless (nothing commits after them), so the
    // chart is unaffected — but claiming them as standing put a false "Excludes 0:05 standing" on
    // a run whose runner never stopped.
    const stop =
      standingStart ||
      (releasing !== null &&
        releasing.committedM / (seconds + releasing.seconds) < STANDSTILL_RATE_MPS);
    if (stop) {
      for (let i = index; i < end; i += 1) stopped[i] = true;
    }
    index = end;
  }
  return stopped;
}

export interface RunProfileFold {
  points: ProfilePoint[];
  /** Seconds the fold discarded as standstill. A LOWER BOUND on standing time (§6's wander case), 0 when the runner never stopped. */
  excludedStandstillS: number;
}

/**
 * Fixes → the chart's pace series, resampled onto a uniform distance grid, plus the seconds folded
 * out as standstill so the card can disclose them (spec §9). Distance is folded with the SAME
 * smoother the stored distance used (ADR 0021 §3), so the chart's x extent agrees with the
 * summary's headline figure — and that smoother's deadband accrual and release (ADR 0021 §2d) is
 * now also what the standstill rule itself rides on. Inputs must already pass `accuracyFilter`.
 * Returns an empty fold for a run that covered no ground, or a `bucketCount` that is not a
 * positive integer.
 */
export function foldRunProfile(
  fixes: readonly LocationFix[],
  bucketCount = bucketCountFor(fixes.length),
): RunProfileFold {
  if (fixes.length === 0) return { points: [], excludedStandstillS: 0 };
  if (!Number.isInteger(bucketCount) || bucketCount < 1) {
    return { points: [], excludedStandstillS: 0 };
  }

  const { legs, total } = legsOf(fixes);
  if (total <= 0) return { points: [], excludedStandstillS: 0 };
  const stopped = stoppedLegs(legs);

  const width = total / bucketCount;
  const meters = new Array<number>(bucketCount).fill(0);
  const seconds = new Array<number>(bucketCount).fill(0);
  let carried = 0;
  let excluded = 0;

  // Legs are split across the buckets they cross so a long one cannot step over a bucket and
  // leave it empty; both measurements behind this are in the pace chart design §5.2.
  for (let i = 0; i < legs.length; i += 1) {
    const leg = legs[i];
    if (leg.kind === 'untimed') continue; // no elapsed time; must not drop the carry
    if (leg.kind === 'gap') {
      carried = 0; // unmeasured; accrual cannot cross it
      continue;
    }
    if (stopped[i]) {
      excluded += leg.seconds;
      continue;
    }
    if (leg.kind !== 'moved') {
      carried += leg.seconds; // held or gated: ride forward onto the leg that finally commits
      continue;
    }

    const legMeters = leg.committedM;
    const legSeconds = leg.seconds + carried;
    carried = 0;
    const first = bucketAt(leg.fromM, width, bucketCount);
    const last = bucketAt(leg.toM, width, bucketCount);
    for (let bucket = first; bucket <= last; bucket += 1) {
      const overlap = Math.min(leg.toM, (bucket + 1) * width) - Math.max(leg.fromM, bucket * width);
      if (overlap <= 0) continue;
      meters[bucket] += overlap;
      seconds[bucket] += legSeconds * (overlap / legMeters);
    }
  }

  return {
    points: meters.map((bucketMeters, index) => ({
      distanceM: (index + 0.5) * width,
      paceSecPerKm:
        bucketMeters > 0 && seconds[index] > 0 ? (seconds[index] / bucketMeters) * 1000 : null,
    })),
    excludedStandstillS: excluded,
  };
}

/** The array form of `foldRunProfile`, for the existing call sites that don't need the excluded figure. */
export function toRunProfile(
  fixes: readonly LocationFix[],
  bucketCount = bucketCountFor(fixes.length),
): ProfilePoint[] {
  return foldRunProfile(fixes, bucketCount).points;
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
