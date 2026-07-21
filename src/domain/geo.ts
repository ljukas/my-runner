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
const EARTH_RADIUS_M = 6_371_000;
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
