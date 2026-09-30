/** Pure numeric helpers — no React/Expo/native imports (ADR 0003). */

/** NaN for an empty input. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Integer parts of `values` that sum exactly to `total` — the leftover units go to the largest
 * fractional parts, ties by order. `total` must be `Math.round` of the values' sum.
 */
export function largestRemainder(values: readonly number[], total: number): number[] {
  const parts = values.map(Math.floor);
  const leftover = total - parts.reduce((sum, part) => sum + part, 0);
  const byRemainder = values
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < leftover; i += 1) parts[byRemainder[i].index] += 1;
  return parts;
}

/** Linear interpolation between order statistics at rank `(n − 1) × p`; NaN for an empty input. */
export function quantile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const rank = (sorted.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}
