import { useRef, useState } from 'react';
import { View } from 'react-native';

import { Island } from '@/components/island';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { Run } from '@/db/schema';
import { isFieldTestRun } from '@/services/field-test';
import {
  isHealthSyncFailure,
  requestWriteAccess,
  syncRunToHealth,
  useHealthAuthorization,
} from '@/services/health';

/**
 * The run summary's Health Connect row — the iOS row's Android fork (ADR 0025 §2), same contract:
 * one button serves the fresh-finish retry and the deliberate push of an older run, since the
 * auto-save fires only on a run's finish (spec §7.1).
 */
export function HealthStatusRow({ run }: { run: Run }) {
  const authorization = useHealthAuthorization();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // why a ref, not just `saving`: guards the tap synchronously, before React has re-rendered the
  // button with `disabled` set.
  const busy = useRef(false);

  // A field-test capture must never reach a health store (spec §8.0); the auto-sync gate at the
  // composition root does not cover this manual path.
  if (isFieldTestRun(run.sessionKey)) return null;

  if (run.healthkitSaved) {
    return (
      <Card surface="card">
        <Text tone="secondary">Saved to Health Connect</Text>
      </Card>
    );
  }

  // Denied and unavailable offer no action here; Settings owns the route to change that.
  if (authorization === 'denied' || authorization === 'unavailable') return null;

  const save = () => {
    if (busy.current) return;
    busy.current = true;
    void (async () => {
      setSaving(true);
      setFailed(false);
      try {
        const granted =
          authorization === 'notDetermined' ? await requestWriteAccess() : authorization;
        // A refusal at the dialog is an answer, not a failure; only 'failed' names a write that
        // threw, and 'saved' flips the row through the summary's live query.
        if (granted === 'authorized') setFailed(isHealthSyncFailure(await syncRunToHealth(run.id)));
      } finally {
        setSaving(false);
        busy.current = false;
      }
    })();
  };

  return (
    <Card surface="card">
      <View className="gap-3">
        {failed ? <Text tone="secondary">Couldn&rsquo;t save to Health Connect.</Text> : null}
        <Island.Button
          fill
          disabled={saving}
          label={saving ? 'Saving…' : 'Save to Health Connect'}
          onPress={save}
        />
      </View>
    </Card>
  );
}
