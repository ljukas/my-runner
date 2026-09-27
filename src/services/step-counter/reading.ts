/**
 * Steps between two readings of a cumulative-since-boot counter; null when the counter went
 * backwards (a reboot reset it), since a negative or partial count would misstate the run.
 */
export function stepsBetween(first: number, latest: number): number | null {
  if (!Number.isFinite(first) || !Number.isFinite(latest) || latest < first) return null;
  return Math.round(latest - first);
}
