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

/** Diagonal of the box in metres — a route's own extent, independent of any viewport or camera. */
export function boundingBoxDiagonalM(bbox: BoundingBox): number {
  return haversineMeters(
    { lat: bbox.minLat, lng: bbox.minLng },
    { lat: bbox.maxLat, lng: bbox.maxLng },
  );
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
  /** why: the two `startAt` paths emit a RAW fix and break track continuity — render must know (ADR 0021 §5). */
  restarted: boolean;
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
      restarted: true,
    };
  }

  const dtSec = (fix.timestamp - state.lastAcceptedTime) / 1000;
  if (dtSec <= 0) {
    return { state, acceptedDeltaMeters: 0, smoothedPoint: null, restarted: false }; // non-monotonic timestamps → no Δt
  }
  if (dtSec > MAX_GAP_S) {
    return {
      state: startAt(state, fix, false),
      acceptedDeltaMeters: 0,
      smoothedPoint: { lat: fix.lat, lng: fix.lng },
      restarted: true,
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
      return { state, acceptedDeltaMeters: 0, smoothedPoint: null, restarted: false };
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

  return { state: s, acceptedDeltaMeters, smoothedPoint, restarted: false };
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

/** why: the first two fixes after a start/gap-reset carry the RAW measurement, and DP always keeps an
 * endpoint — a legal 50 m fix would otherwise be a permanent spur and would inflate the camera fit. */
export const SEED_FIXES = 2;

export interface RenderPoint {
  point: LatLng;
  segmentSeq: number;
  /** True when this point is the first emitted after a real GPS gap (ADR 0021 §5) — never for the track's start. */
  gapBefore: boolean;
}

/**
 * Render-side fold over `smoothFix` — same reducer as the live engine, so the drawn line is the same
 * smoothed track the distance came from. Presentation only: never a distance source (ADR 0021 §6).
 * Inputs must already pass `accuracyFilter`.
 */
export function smoothTrackForRender(fixes: readonly SegmentedFix[]): RenderPoint[] {
  let state = createSmootherState();
  const out: RenderPoint[] = [];
  let pendingGap = false;

  for (const fix of fixes) {
    const step = smoothFix(state, fix);
    state = step.state;
    if (step.restarted && out.length > 0) pendingGap = true;
    if (!step.smoothedPoint || state.fixesSinceReset <= SEED_FIXES) continue;
    out.push({ point: step.smoothedPoint, segmentSeq: fix.segmentSeq, gapBefore: pendingGap });
    pendingGap = false;
  }
  return out;
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

/** why: the viewer zooms in far enough that the card's 5 m epsilon visibly cuts corners. */
export const VIEWER_DP_EPSILON_M = 2;

export interface SegmentPolyline {
  segmentSeq: number;
  points: LatLng[];
  gapBefore: boolean;
}

/**
 * One DP-simplified polyline per contiguous segment run. Adjacent non-gap chunks share their boundary
 * coordinate by object reference (`simplifyPolyline` always retains endpoints), so differently-coloured
 * lines meet exactly; a real gap deliberately does not, leaving the break the track actually has.
 */
export function toSegmentPolylines(
  renderPoints: readonly RenderPoint[],
  epsilon = DP_EPSILON_M,
): SegmentPolyline[] {
  const chunks: SegmentPolyline[] = [];
  let current: SegmentPolyline | null = null;
  // why: the seam anchor is the last point actually drawn, which may predate the previous segment —
  // a segment whose fixes were all gated contributes none.
  let lastEmitted: LatLng | null = null;

  for (const rp of renderPoints) {
    if (!current || rp.segmentSeq !== current.segmentSeq || rp.gapBefore) {
      if (current) chunks.push(current);
      current = {
        segmentSeq: rp.segmentSeq,
        points: !rp.gapBefore && lastEmitted ? [lastEmitted] : [],
        gapBefore: rp.gapBefore,
      };
    }
    current.points.push(rp.point);
    lastEmitted = rp.point;
  }
  if (current) chunks.push(current);

  const kept: SegmentPolyline[] = [];
  // why: a dropped chunk must hand its break on, or chevrons interpolate across the void it left.
  let pendingGap = false;
  for (const chunk of chunks) {
    const points = simplifyPolyline(chunk.points, epsilon);
    pendingGap = pendingGap || chunk.gapBefore;
    if (points.length < 2) continue;
    kept.push({ ...chunk, points, gapBefore: pendingGap });
    pendingGap = false;
  }
  return kept;
}

/** why: without a floor a stationary run's zero-span bbox yields zoom = Infinity. */
export const MIN_SPAN_DEG = 0.0005;
/** Fraction of the content span added per side; the slack it buys is p/(1+2p) (spec §4.2). */
export const CAMERA_PADDING_RATIO = 0.15;

export interface CameraFit {
  center: LatLng;
  /** expo-maps zoom: the library shows `360 / 2^zoom` degrees on BOTH axes (spec §3). */
  zoom: number;
  /** Vertical extent the camera will show, in metres — the scale chevron sizing tracks (spec §5). */
  fittedSpanM: number;
}

/**
 * Smallest camera that provably contains `bbox` at the given viewport aspect ratio (width / height).
 * Needs no pixel dimensions: the library's span is isotropic in degrees and MapKit only ever expands
 * a requested region, so the failure mode is a marginally loose frame, never a clipped route.
 * Antimeridian- and pole-naive, like `boundingBox`.
 */
export function cameraForBoundingBox(
  bbox: BoundingBox,
  aspectRatio: number,
  paddingRatio = CAMERA_PADDING_RATIO,
): CameraFit {
  // why: a pre-layout viewport measures 0/0, which turns the whole fit NaN.
  const aspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const centerLat = (bbox.minLat + bbox.maxLat) / 2;
  const f = 1 / Math.cos(centerLat * DEG_TO_RAD);
  const latSpanDeg = bbox.maxLat - bbox.minLat;
  const lngSpanDeg = bbox.maxLng - bbox.minLng;

  const neededDeg = Math.max(
    lngSpanDeg / Math.max(1, aspect * f),
    (latSpanDeg * f) / Math.max(1 / aspect, f),
  );
  const pad = 1 + 2 * paddingRatio;
  const spanDeg = Math.max(neededDeg, MIN_SPAN_DEG) * pad;

  return {
    center: { lat: centerLat, lng: (bbox.minLng + bbox.maxLng) / 2 },
    zoom: Math.log2(360 / spanDeg),
    // why: read off the same `spanDeg` the zoom asks for, so the two cannot disagree.
    fittedSpanM: (spanDeg * Math.max(f, 1 / aspect) * M_PER_DEG) / f,
  };
}

/** why: a treadmill run has plenty of fixes and no extent — without this the card draws a dot on a
 * street map of the user's home (spec §8). Compared against `boundingBoxDiagonalM` over the drawn
 * chunks, never a camera span: those are aspect-dependent and floored above this value, so a route
 * could clear the gate on one surface and fail it on another, or never be rejected at all. */
export const MIN_ROUTE_EXTENT_M = 60;

/** Chevron size as a fraction of the camera's fitted span — NOT the bbox diagonal, which the camera
 * does not track (spec §5): diagonal-sizing varies on-screen size ~2x from bbox shape alone. */
export const CHEVRON_SIZE_RATIO = 0.05;
export const CHEVRON_MIN_SIZE_M = 3;
/** A sanity rail, not a design parameter: it must NOT bind inside the C25K range, or arrows shrink on
 * screen as the diagonal-sizing bug did. 400 m bound at the 5 km goal state (~14 km fitted, portrait). */
export const CHEVRON_MAX_SIZE_M = 800;
export const CHEVRON_TARGET_COUNT = 8;
export const CHEVRON_MIN_SPACING_MULTIPLIER = 4;
export const CHEVRON_MIN_RUN_LENGTH_M = 20;
export const CHEVRON_WING_DEG = 35;
/** why: two marks closer than half an arrow-length read as one mark whatever their bearings, so the
 * radius is bearing-blind — a bearing test let same-direction laps stack 8 arrows on one spot. */
export const CHEVRON_DEDUPE_MULTIPLIER = 0.5;

export interface Chevron {
  /** [back-left, tip, back-right] — a ">" pointing along travel; wings are equidistant from the tip. */
  points: readonly [LatLng, LatLng, LatLng];
}

function bearingRad(a: LatLng, b: LatLng, cosLat: number): number {
  const east = (b.lng - a.lng) * cosLat;
  const north = b.lat - a.lat;
  if (east === 0 && north === 0) return NaN; // duplicated vertex — atan2(0,0) would read as due north
  return Math.atan2(east, north);
}

function offsetMeters(from: LatLng, bearing: number, distM: number, cosLat: number): LatLng {
  return {
    lat: from.lat + (Math.cos(bearing) * distM) / M_PER_DEG,
    lng: from.lng + (Math.sin(bearing) * distM) / (M_PER_DEG * cosLat),
  };
}

function gapFreeRuns(chunks: readonly SegmentPolyline[]): LatLng[][] {
  const runs: LatLng[][] = [];
  let current: LatLng[] | null = null;
  for (const chunk of chunks) {
    if (!current || chunk.gapBefore) {
      current = [];
      runs.push(current);
    }
    for (const point of chunk.points) {
      const previous = current.at(-1);
      // why: adjacent chunks share their boundary vertex, so concatenating duplicates it — and a
      // zero-length segment makes the bearing degenerate.
      if (previous && previous.lat === point.lat && previous.lng === point.lng) continue;
      current.push(point);
    }
  }
  return runs;
}

/**
 * Direction arrows along the drawn route. Rides the already-simplified geometry (cheaper, and much less
 * bearing jitter than the raw stream). Spacing is global across runs so gaps cannot multiply the count,
 * and a candidate too close to a placed arrow is dropped: retraced ground never stacks marks, at the
 * cost of a multi-lap route getting one arrow per physical spot rather than an even spread.
 */
export function chevronsAlongRoute(
  chunks: readonly SegmentPolyline[],
  fittedSpanM: number,
): Chevron[] {
  const sizeM = Math.min(
    Math.max(fittedSpanM * CHEVRON_SIZE_RATIO, CHEVRON_MIN_SIZE_M),
    CHEVRON_MAX_SIZE_M,
  );

  const runs = gapFreeRuns(chunks)
    .map((points) => {
      const cumulative = [0];
      for (let i = 1; i < points.length; i++) {
        cumulative.push(cumulative[i - 1] + haversineMeters(points[i - 1], points[i]));
      }
      return { points, cumulative, length: cumulative.at(-1) ?? 0 };
    })
    // why: a fragment shorter than the arrow it would carry cannot show one legibly.
    .filter(
      (run) => run.length >= Math.max(CHEVRON_MIN_RUN_LENGTH_M, sizeM) && run.points.length >= 2,
    );

  const totalM = runs.reduce((sum, run) => sum + run.length, 0);
  if (totalM === 0) return [];

  const spacingM = Math.max(totalM / CHEVRON_TARGET_COUNT, sizeM * CHEVRON_MIN_SPACING_MULTIPLIER);
  // why: the placement loop's only exit is a comparison, so a NaN spacing loops forever.
  if (!Number.isFinite(spacingM) || spacingM <= 0) return [];
  const wing = CHEVRON_WING_DEG * DEG_TO_RAD;
  const accepted: { tip: LatLng; bearing: number; cosLat: number }[] = [];

  let runStart = 0;
  for (const run of runs) {
    for (let target = spacingM / 2; ; target += spacingM) {
      const local = target - runStart;
      if (local < 0) continue;
      if (local > run.length) break;

      let i = 1;
      while (i < run.cumulative.length - 1 && run.cumulative[i] < local) i += 1;
      const from = run.points[i - 1];
      const to = run.points[i];
      const segmentM = run.cumulative[i] - run.cumulative[i - 1];
      const t = segmentM === 0 ? 0 : (local - run.cumulative[i - 1]) / segmentM;
      const tip: LatLng = {
        lat: from.lat + (to.lat - from.lat) * t,
        lng: from.lng + (to.lng - from.lng) * t,
      };

      const cosLat = Math.cos(tip.lat * DEG_TO_RAD);
      const bearing = bearingRad(from, to, cosLat);
      // why: defensive — unreachable while the placement scan's `<` is strict, which may change.
      if (Number.isNaN(bearing)) continue;

      const clash = accepted.some(
        (other) => haversineMeters(other.tip, tip) < sizeM * CHEVRON_DEDUPE_MULTIPLIER,
      );
      if (!clash) accepted.push({ tip, bearing, cosLat });
    }
    runStart += run.length;
  }

  return accepted.map(({ tip, bearing, cosLat }) => ({
    points: [
      offsetMeters(tip, bearing + Math.PI + wing, sizeM, cosLat),
      tip,
      offsetMeters(tip, bearing + Math.PI - wing, sizeM, cosLat),
    ] as const,
  }));
}
