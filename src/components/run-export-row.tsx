import { useState } from 'react';
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
  const [status, setStatus] = useState<'idle' | 'busy' | 'failed'>('idle');

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
          {status === 'failed'
            ? 'Export failed — see the logs.'
            : `${counts.points} GPS fixes · ${counts.samples} altitude samples`}
        </Text>
      </View>
      <Island.Button
        fill
        testID="export-run-data"
        disabled={status === 'busy'}
        label={status === 'busy' ? 'Preparing…' : 'Export run data'}
        onPress={() => {
          setStatus('busy');
          void exportRun(run.id).then((result) => {
            setStatus(result === 'shared' ? 'idle' : 'failed');
          });
        }}
      />
    </Card>
  );
}
