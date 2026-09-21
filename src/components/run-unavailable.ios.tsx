import { ContentUnavailableView } from '@expo/ui/swift-ui';

import { Island } from '@/components/island';

export type RunUnavailableReason = 'unsaved' | 'missing' | 'no-route';

const COPY = {
  unsaved: {
    title: 'Run not saved',
    systemImage: 'exclamationmark.triangle',
    description: "This run couldn't be saved.",
  },
  missing: {
    title: 'Run unavailable',
    systemImage: 'questionmark.circle',
    description: "This run isn't available.",
  },
  'no-route': {
    title: 'No route',
    systemImage: 'map',
    description: "There's no map for this run.",
  },
} as const;

/**
 * The empty state shared by the run summary and the route viewer (ADR 0013 domain component).
 * `missing` covers a soft-deleted run too — deleted and never-existed are the same to the reader,
 * and saying "deleted" would confirm a run the user asked us to forget.
 */
export function RunUnavailable({ reason }: { reason: RunUnavailableReason }) {
  return (
    <Island>
      <ContentUnavailableView {...COPY[reason]} />
    </Island>
  );
}
