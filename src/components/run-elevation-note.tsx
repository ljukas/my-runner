import { Text } from '@/components/ui/text';
import type { SummaryElevation } from '@/domain/run-summary';

const NOTE: Record<SummaryElevation['status'], string> = {
  estimated: 'Elevation is estimated from air pressure and can drift with the weather.',
  insufficient: 'Elevation requires more data.',
};

/**
 * The run summary's one line about its elevation (ADR 0013 domain component): the estimate caveat
 * beside a shown gain, or why a run that recorded barometer samples shows none. Nothing for a run
 * with no samples at all — "more data" would be untrue of a phone without a barometer.
 */
export function RunElevationNote({ elevation }: { elevation: SummaryElevation | null }) {
  if (!elevation) return null;
  return (
    <Text variant="footnote" tone="secondary" className="px-4">
      {NOTE[elevation.status]}
    </Text>
  );
}
