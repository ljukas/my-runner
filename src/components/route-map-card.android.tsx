import type { Run } from '@/db/schema';
import type { RunTrack } from '@/hooks/use-run-track';

// No route map until the Android maps stage (ADR 0025); the card is absent rather than "unavailable".
export function RouteMapCard(_props: { run: Run; track: RunTrack }) {
  return null;
}
