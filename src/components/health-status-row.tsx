import { useState } from 'react';
import { View } from 'react-native';

import { Island } from '@/components/island';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { Run } from '@/db/schema';
import { healthAdapter, syncRunToHealth, useHealthAuthorization } from '@/services/health';

/**
 * The run summary's Apple Health row (ADR 0013 domain component). One button serves both the
 * fresh-finish retry and the deliberate push of an older run — the auto-save fires only on a run's
 * finish, so a revisited run is never backfilled behind the user's back (spec §2, §7.1).
 */
export function HealthStatusRow({ run }: { run: Run }) {
  const authorization = useHealthAuthorization();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  if (run.healthkitSaved) {
    return (
      <Card surface="card">
        <Text tone="secondary">Saved to Apple Health</Text>
      </Card>
    );
  }

  // Denied and unavailable offer no action here; Settings owns the route to change that.
  if (authorization === 'denied' || authorization === 'unavailable') return null;

  const save = async () => {
    setSaving(true);
    setFailed(false);
    const granted =
      authorization === 'notDetermined' ? await healthAdapter.requestWriteAccess() : authorization;
    // A denial at the prompt is an answer, not a failure — leave the row quiet.
    if (granted === 'authorized') setFailed(!(await syncRunToHealth(run.id)));
    setSaving(false);
  };

  return (
    <Card surface="card">
      <View className="gap-3">
        {failed ? <Text tone="secondary">Couldn&rsquo;t save to Apple Health.</Text> : null}
        <Island.Button
          fill
          label={saving ? 'Saving…' : 'Save to Apple Health'}
          onPress={() => void save()}
        />
      </View>
    </Card>
  );
}
