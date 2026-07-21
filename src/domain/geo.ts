/** Pure geospatial math — no React/Expo/native imports (ADR 0003). */

/** One GPS sample. */
export interface LocationFix {
  /** Epoch ms (wall clock); the adapter serializes it to the ISO `run_points.timestamp` column. */
  timestamp: number;
  lat: number;
  lng: number;
  /** Metres above sea level; null when the fix carried no altitude. */
  altitude: number | null;
  /** Horizontal accuracy radius in metres; null when unknown. */
  accuracy: number | null;
  /** Ground speed in m/s; null when unavailable. */
  speed: number | null;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const ACCURACY_LIMIT_M = 50;
export const EARTH_RADIUS_M = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Accept a fix only if accuracy is known, positive, and within 50 m (spec §11).
 * why: iOS uses a negative `horizontalAccuracy` to flag an invalid position; 0 and NaN also fail.
 */
export function accuracyFilter(fix: LocationFix): boolean {
  return fix.accuracy != null && fix.accuracy > 0 && fix.accuracy <= ACCURACY_LIMIT_M;
}

/**
 * Great-circle distance (haversine), degrees in and metres out.
 * why: the spherical Earth model's ~0.1% error is well below GPS noise over a run's short segments.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Axis-aligned min/max lat/lng, or null for an empty set (a zeroed box would fit the map to Null Island).
 * Antimeridian-naive — fine for the C25K footprint, which never crosses the date line.
 */
export function boundingBox(points: readonly LatLng[]): BoundingBox | null {
  if (points.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Google encoded polyline for the sequence (empty input → ''). Precision must be ≤ 6:
 * the encoder's 32-bit bitwise ops overflow at ≥ 7 and silently corrupt output.
 */
export function encodePolyline(points: readonly LatLng[], precision = 5): string {
  const factor = 10 ** precision;
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  for (const p of points) {
    const lat = Math.round(p.lat * factor);
    const lng = Math.round(p.lng * factor);
    out += encodeSigned(lat - prevLat) + encodeSigned(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

/** Zig-zag + 5-bit-chunk encode of one signed delta. */
function encodeSigned(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

// GPS smoothing pipeline — ADR 0021 §2. Authoritative distance is derived from the smoothed
// stream here; the DP line (simplifyPolyline) is render-only and never feeds distance.

// Load-bearing smoothing params (ADR 0021 "Parameters"); the fallback ladder retunes these at Milestone-0.
export const RUNNING_SPEED_CEILING_MPS = 6.5;
export const VELOCITY_GATE_MARGIN = 1.5;
export const MEDIAN_WINDOW_SIZE = 5;
/** Continuous white-noise acceleration spectral density (m²/s³); the smoothing↔lag knob. */
export const KALMAN_PROCESS_NOISE = 1;
export const NEAR_STATIONARY_DEADBAND_M = 1.5;
export const NEAR_STATIONARY_SPEED_MPS = 0.5;
export const MAX_GAP_S = 30;
export const DP_EPSILON_M = 5;

const M_PER_DEG = EARTH_RADIUS_M * DEG_TO_RAD;
const DEFAULT_ACCURACY_M = ACCURACY_LIMIT_M;

export interface SmootherState {
  started: boolean;
  refLat: number;
  refLng: number;
  cosRefLat: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  // One covariance triple for both axes: the recursion depends only on Δt and R, never the measurements.
  ppp: number;
  ppv: number;
  pvv: number;
  // 1 ⇒ the next accepted fix seeds velocity from two points — kills startup lag so a CV walker's distance stays exact.
  fixesSinceReset: number;
  lastAcceptedTime: number;
  window: { lat: number; lng: number; t: number }[];
  anchorLat: number;
  anchorLng: number;
  totalDistanceM: number;
}

export interface SmoothStep {
  state: SmootherState;
  /** Distance committed by this fix; 0 when gated, held by the deadband, or a start/reset. */
  acceptedDeltaMeters: number;
  /** Smoothed position for this fix, or null when the velocity gate rejected it. */
  smoothedPoint: LatLng | null;
}

export interface SmoothedTrack {
  distanceM: number;
  points: LatLng[];
}

export interface SegmentedFix extends LocationFix {
  segmentSeq: number;
}

/** `smoothTrack` result plus per-`segmentSeq` metres (ADR 0021 §4): sparse — only seqs that accrued distance appear — and summing exactly to `distanceM`. */
export interface SmoothedRollup extends SmoothedTrack {
  distanceBySegmentSeq: Map<number, number>;
}

export function createSmootherState(): SmootherState {
  return {
    started: false,
    refLat: 0,
    refLng: 0,
    cosRefLat: 1,
    px: 0,
    py: 0,
    vx: 0,
    vy: 0,
    ppp: 0,
    ppv: 0,
    pvv: 0,
    fixesSinceReset: 0,
    lastAcceptedTime: 0,
    window: [],
    anchorLat: 0,
    anchorLng: 0,
    totalDistanceM: 0,
  };
}

function measurementVariance(fix: LocationFix): number {
  const acc = fix.accuracy != null && fix.accuracy > 0 ? fix.accuracy : DEFAULT_ACCURACY_M;
  return acc * acc;
}

function projectX(s: SmootherState, lng: number): number {
  return (lng - s.refLng) * M_PER_DEG * s.cosRefLat;
}
function projectY(s: SmootherState, lat: number): number {
  return (lat - s.refLat) * M_PER_DEG;
}
function unprojectLat(s: SmootherState, y: number): number {
  return s.refLat + y / M_PER_DEG;
}
function unprojectLng(s: SmootherState, x: number): number {
  return s.refLng + x / (M_PER_DEG * s.cosRefLat);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// (Re)start the filter anchored at `fix`. A gap reset keeps the metre-plane origin (setRef=false) so
// both sides of the gap share one plane; the across-gap chord is never counted (the anchor jumps here).
function startAt(base: SmootherState, fix: LocationFix, setRef: boolean): SmootherState {
  const refLat = setRef ? fix.lat : base.refLat;
  const refLng = setRef ? fix.lng : base.refLng;
  const cosRefLat = setRef ? Math.cos(refLat * DEG_TO_RAD) : base.cosRefLat;
  const s: SmootherState = {
    ...base,
    started: true,
    refLat,
    refLng,
    cosRefLat,
    vx: 0,
    vy: 0,
    ppp: measurementVariance(fix),
    ppv: 0,
    pvv: 0,
    fixesSinceReset: 1,
    lastAcceptedTime: fix.timestamp,
    window: [{ lat: fix.lat, lng: fix.lng, t: fix.timestamp }],
    anchorLat: fix.lat,
    anchorLng: fix.lng,
  };
  s.px = projectX(s, fix.lng);
  s.py = projectY(s, fix.lat);
  return s;
}

/**
 * Forward/causal reducer (ADR 0021 §2): one accepted fix → next state, the distance it commits, and its
 * smoothed point (null when the velocity gate rejects it). Inputs must already pass `accuracyFilter`.
 */
export function smoothFix(state: SmootherState, fix: LocationFix): SmoothStep {
  if (!state.started) {
    return {
      state: startAt(state, fix, true),
      acceptedDeltaMeters: 0,
      smoothedPoint: { lat: fix.lat, lng: fix.lng },
    };
  }

  const dtSec = (fix.timestamp - state.lastAcceptedTime) / 1000;
  if (dtSec <= 0) {
    return { state, acceptedDeltaMeters: 0, smoothedPoint: null }; // non-monotonic timestamps → no Δt
  }
  if (dtSec > MAX_GAP_S) {
    return {
      state: startAt(state, fix, false),
      acceptedDeltaMeters: 0,
      smoothedPoint: { lat: fix.lat, lng: fix.lng },
    };
  }

  const refLatM = median(state.window.map((w) => w.lat));
  const refLngM = median(state.window.map((w) => w.lng));
  const refTime = median(state.window.map((w) => w.t));
  const dtMed = (fix.timestamp - refTime) / 1000;
  if (dtMed > 0) {
    const implied =
      haversineMeters({ lat: refLatM, lng: refLngM }, { lat: fix.lat, lng: fix.lng }) / dtMed;
    if (implied > RUNNING_SPEED_CEILING_MPS * VELOCITY_GATE_MARGIN) {
      return { state, acceptedDeltaMeters: 0, smoothedPoint: null };
    }
  }

  const R = measurementVariance(fix);
  const s: SmootherState = { ...state, window: state.window.slice() };
  const zx = projectX(s, fix.lng);
  const zy = projectY(s, fix.lat);

  if (s.fixesSinceReset === 1) {
    s.vx = (zx - s.px) / dtSec;
    s.vy = (zy - s.py) / dtSec;
    s.px = zx;
    s.py = zy;
    s.ppp = R;
    s.ppv = R / dtSec;
    s.pvv = (2 * R) / (dtSec * dtSec);
  } else {
    const q = KALMAN_PROCESS_NOISE;
    const dt = dtSec;
    const predPx = s.px + s.vx * dt;
    const predPy = s.py + s.vy * dt;
    const predPpp = s.ppp + 2 * dt * s.ppv + dt * dt * s.pvv + (q * dt * dt * dt) / 3;
    const predPpv = s.ppv + dt * s.pvv + (q * dt * dt) / 2;
    const predPvv = s.pvv + q * dt;
    const innovVar = predPpp + R;
    const kp = predPpp / innovVar;
    const kv = predPpv / innovVar;
    const resX = zx - predPx;
    const resY = zy - predPy;
    s.px = predPx + kp * resX;
    s.py = predPy + kp * resY;
    s.vx = s.vx + kv * resX;
    s.vy = s.vy + kv * resY;
    s.ppp = (1 - kp) * predPpp;
    s.ppv = (1 - kp) * predPpv;
    s.pvv = predPvv - kv * predPpv;
  }

  s.fixesSinceReset += 1;
  s.lastAcceptedTime = fix.timestamp;
  s.window.push({ lat: fix.lat, lng: fix.lng, t: fix.timestamp });
  if (s.window.length > MEDIAN_WINDOW_SIZE) s.window.shift();

  const smoothedPoint: LatLng = { lat: unprojectLat(s, s.py), lng: unprojectLng(s, s.px) };
  const smoothedSpeed = Math.hypot(s.vx, s.vy);
  const d = haversineMeters({ lat: s.anchorLat, lng: s.anchorLng }, smoothedPoint);

  // Carried-residual deadband (ADR 0021 §2d): hold the anchor while near-stationary and under the deadband,
  // so a slow-but-real crawl accrues and commits in full once it clears. NB it does NOT fully suppress a
  // stationary GPS wander — an out-and-back drift still commits (ADR/Milestone-0 open item).
  let acceptedDeltaMeters = 0;
  if (smoothedSpeed >= NEAR_STATIONARY_SPEED_MPS || d >= NEAR_STATIONARY_DEADBAND_M) {
    acceptedDeltaMeters = d;
    s.totalDistanceM += d;
    s.anchorLat = smoothedPoint.lat;
    s.anchorLng = smoothedPoint.lng;
  }

  return { state: s, acceptedDeltaMeters, smoothedPoint };
}

/**
 * Batch fold of `smoothFix` from a fresh state — identical to the engine's live per-fix ingest, so live
 * and re-derived distances agree (ADR 0021 §3). `distanceM` (== summed `acceptedDeltaMeters`) is the
 * authoritative distance; `points` is render-only. Inputs must already pass `accuracyFilter`.
 */
export function smoothTrack(fixes: readonly LocationFix[]): SmoothedTrack {
  let state = createSmootherState();
  const points: LatLng[] = [];
  let distanceM = 0;
  for (const fix of fixes) {
    const step = smoothFix(state, fix);
    state = step.state;
    distanceM += step.acceptedDeltaMeters;
    if (step.smoothedPoint) points.push(step.smoothedPoint);
  }
  return { distanceM, points };
}

/** Per-segment fold of `smoothFix` (ADR 0021 §4): each committed delta is bucketed under its END fix's `segmentSeq`, so buckets sum to `distanceM` and `distanceM` matches `smoothTrack`'s exactly. Inputs must already pass `accuracyFilter`. */
export function smoothTrackBySegment(fixes: readonly SegmentedFix[]): SmoothedRollup {
  let state = createSmootherState();
  const points: LatLng[] = [];
  const distanceBySegmentSeq = new Map<number, number>();
  let distanceM = 0;
  for (const fix of fixes) {
    const step = smoothFix(state, fix);
    state = step.state;
    distanceM += step.acceptedDeltaMeters;
    if (step.acceptedDeltaMeters > 0) {
      distanceBySegmentSeq.set(
        fix.segmentSeq,
        (distanceBySegmentSeq.get(fix.segmentSeq) ?? 0) + step.acceptedDeltaMeters,
      );
    }
    if (step.smoothedPoint) points.push(step.smoothedPoint);
  }
  return { distanceM, points, distanceBySegmentSeq };
}

function perpDistanceM(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Douglas–Peucker simplification for the Stage 4 route render — presentation only; distance is never
 * derived from this. `epsilon` and perpendicular distances are metres in a local plane about the first
 * point. Endpoints are always kept; ≤ 2 points return a copy.
 */
export function simplifyPolyline(points: readonly LatLng[], epsilon = DP_EPSILON_M): LatLng[] {
  if (points.length <= 2) return points.slice();
  const lat0 = points[0].lat;
  const lng0 = points[0].lng;
  const cosLat0 = Math.cos(lat0 * DEG_TO_RAD);
  const x = (p: LatLng) => (p.lng - lng0) * M_PER_DEG * cosLat0;
  const y = (p: LatLng) => (p.lat - lat0) * M_PER_DEG;

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    const ax = x(points[start]);
    const ay = y(points[start]);
    const bx = x(points[end]);
    const by = y(points[end]);
    let maxDist = -1;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const dist = perpDistanceM(x(points[i]), y(points[i]), ax, ay, bx, by);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (maxDist > epsilon && index !== -1) {
      keep[index] = true;
      stack.push([start, index]);
      stack.push([index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
