/**
 * Pure geospatial math for the run tracker — no React/Expo/native imports
 * (ADR 0003), fully unit-tested under `bun test`. The run engine ingests a
 * stream of `LocationFix`es; Stage 4 (route map) / Stage 5 (HealthKit) read the
 * persisted points back from SQLite.
 */

/**
 * One GPS sample. The measurement fields (lat/lng/altitude/accuracy/speed)
 * mirror the `run_points` columns (spec §4); `timestamp` is held here as epoch
 * milliseconds (matching the engine's event log) and is serialized to the
 * `run_points.timestamp` TEXT (ISO) column by the persistence adapter — that
 * conversion is owned by T4/T11, not this module.
 */
export interface LocationFix {
  /** Epoch milliseconds (wall clock), matching the engine's event log. */
  timestamp: number;
  lat: number;
  lng: number;
  /** Metres above sea level, or null when the fix carried no altitude. */
  altitude: number | null;
  /** Horizontal accuracy radius in metres, or null when unknown. */
  accuracy: number | null;
  /** Instantaneous ground speed in m/s, or null when unavailable. */
  speed: number | null;
}

/** Minimal geometry shape — satisfied by `LocationFix` and by persisted `run_points` rows. */
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
const EARTH_RADIUS_M = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Accept a fix only if its position is trustworthy for distance math: accuracy
 * must be known (non-null), positive, and within the 50 m radius (spec §11 /
 * ADR 0008). Null, zero, and negative are rejected — iOS surfaces a negative
 * `CLLocation.horizontalAccuracy` to mean the lat/lng are invalid, and a zero
 * radius is physically implausible for GPS; a NaN accuracy also fails the
 * comparison and is rejected.
 */
export function accuracyFilter(fix: LocationFix): boolean {
  return fix.accuracy != null && fix.accuracy > 0 && fix.accuracy <= ACCURACY_LIMIT_M;
}

/**
 * Great-circle distance in metres between two lat/lng points (haversine).
 * Uses the IUGG spherical-mean Earth radius 6 371 000 m; the ~0.1 % model
 * error is far below GPS noise over a run's short consecutive segments.
 * Handles the antimeridian naturally (Δλ enters only via the periodic
 * sin²(Δλ/2)) and returns 0 for identical points. Input degrees, output metres.
 * Precondition: finite inputs — non-finite lat/lng propagate to NaN (the
 * accuracyFilter gate rejects such fixes upstream on the live path).
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
 * Axis-aligned min/max lat/lng over the points — the Stage 4 map camera-fit
 * box. Returns null for an empty set (no box to fit; a zeroed box would fit the
 * camera to Null Island). A single point yields a degenerate zero-area box.
 * Antimeridian-naive: a route straddling ±180° longitude yields the long-way
 * box (min/max are taken literally) — acceptable for the C25K footprint, which
 * never crosses the date line. Precondition: finite inputs.
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
 * Google encoded-polyline string for the point sequence (default precision 5,
 * i.e. 1e-5° resolution — the maps standard; spec §4). Empty input yields ''.
 * Precision must be ≤ 6: the encoder's 32-bit bitwise ops overflow at precision
 * ≥ 7 (a scaled coordinate delta can exceed 2³¹) and silently corrupt output.
 * Algorithm:
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
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

/** One signed integer delta, zig-zag encoded into 5-bit little-endian chunks. */
function encodeSigned(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>>= 5;
  }
  return out + String.fromCharCode(v + 63);
}
