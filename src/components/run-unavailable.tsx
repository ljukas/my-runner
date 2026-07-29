import { ContentUnavailableView } from '@expo/ui/swift-ui';

import { Island } from '@/components/island';

/**
 * The unsaved/unavailable state shared by the run summary and the route
 * viewer (ADR 0013 domain component) — an in-progress run that never got a
 * `runs` row, versus a `runId` with none.
 */
export function RunUnavailable({ unsaved }: { unsaved: boolean }) {
  return (
    <Island>
      <ContentUnavailableView
        title={unsaved ? 'Run not saved' : 'Run unavailable'}
        systemImage={unsaved ? 'exclamationmark.triangle' : 'questionmark.circle'}
        description={unsaved ? "This run couldn't be saved." : "This run isn't available."}
      />
    </Island>
  );
}
