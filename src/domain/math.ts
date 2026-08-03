/** Pure numeric helpers — no React/Expo/native imports (ADR 0003). */

/** Middle value, or the mean of the two middle values; NaN for an empty input. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
