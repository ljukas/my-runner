import { useRef, useState } from 'react';
import { View } from 'react-native';

import { Island } from '@/components/island';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { loadRunCounts } from '@/db/run-log';
import type { Run } from '@/db/schema';
import { exportRun } from '@/services/run-export';

/**
 * Field-data export (spec §7.3). The counts are the only in-app confirmation that capture
 * worked, so they are checkable before a 30-minute run's data is trusted.
 */
export function RunExportRow({ run }: { run: Run }) {
  const [counts] = useState(() => loadRunCounts(run.id));
  const [status, setStatus] = useState<'idle' | 'busy' | 'unavailable' | 'failed'>('idle');
  // why a ref, not just `status`: guards the tap synchronously, before React has re-rendered the
  // button with `disabled` set — same idiom as health-status-row's async-CTA guard.
  const busy = useRef(false);

  const statusText =
    status === 'failed'
      ? "Couldn't export the run data. You can try again."
      : status === 'unavailable'
        ? "Exporting isn't available right now. You can try again in a bit."
        : `${counts.points} GPS fixes · ${counts.samples} altitude samples`;

  return (
    <Card surface="card" className="gap-3">
      <View className="gap-1">
        <Text
          variant="footnote"
          tone="secondary"
          className="font-semibold"
          accessibilityRole="header"
        >
          Field data
        </Text>
        <Text variant="caption" tone="secondary">
          {statusText}
        </Text>
      </View>
      <Island.Button
        fill
        disabled={status === 'busy'}
        label={status === 'busy' ? 'Preparing…' : 'Export run data'}
        onPress={() => {
          if (busy.current) return;
          busy.current = true;
          setStatus('busy');
          void exportRun(run.id)
            .then((result) => setStatus(result === 'shared' ? 'idle' : result))
            .finally(() => {
              busy.current = false;
            });
        }}
      />
    </Card>
  );
}
