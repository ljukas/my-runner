import { useRef, useState } from 'react';
import { View } from 'react-native';

import { Island } from '@/components/island';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { HEALTH_STORE } from '@/constants/health-store';
import type { Run } from '@/db/schema';
import { isFieldTestRun } from '@/services/field-test';
import {
  isHealthSyncFailure,
  openHealthStore,
  requestWriteAccess,
  syncRunToHealth,
  useHealthAuthorization,
} from '@/services/health';

/**
 * The run summary's health-store row (ADR 0013 domain component). One button serves both the
 * fresh-finish retry and the deliberate push of an older run — the auto-save fires only on a run's
 * finish, so a revisited run is never backfilled behind the user's back (spec §2, §7.1).
 */
export function HealthStatusRow({ run }: { run: Run }) {
  const authorization = useHealthAuthorization();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // why a ref, not just `saving`: guards the tap synchronously, before React has re-rendered the
  // button with `disabled` set — same idiom as onboarding-step-screen's async-CTA guard.
  const busy = useRef(false);

  // A field-test capture must never reach a health store (spec §8.0) — the composition root only
  // gates the auto-sync on finish, so this manual retry needs its own guard too, or the row would
  // be the one path left to defeat it.
  if (isFieldTestRun(run.sessionKey)) return null;

  if (run.healthkitSaved) {
    return (
      <Card surface="card">
        <Text tone="secondary">{`Saved to ${HEALTH_STORE}`}</Text>
      </Card>
    );
  }

  // Denied and unavailable offer no action here; Settings owns the route to change that.
  if (authorization === 'denied' || authorization === 'unavailable') return null;

  // why literal: updateRequired is Android-only.
  if (authorization === 'updateRequired') {
    return (
      <Card surface="card">
        <View className="gap-3">
          <Text tone="secondary">
            Saving runs to Health Connect needs the Health Connect app, or an update to it.
          </Text>
          <Island.Button fill label="Get Health Connect" onPress={() => void openHealthStore()} />
        </View>
      </Card>
    );
  }

  const save = () => {
    if (busy.current) return;
    busy.current = true;
    void (async () => {
      setSaving(true);
      setFailed(false);
      try {
        const granted =
          authorization === 'notDetermined' ? await requestWriteAccess() : authorization;
        // A denial at the prompt is an answer, not a failure — leave the row quiet. 'busy' and
        // 'skipped' are no-ops too (finding 1): only 'failed' names an actual write failure, and
        // 'saved' flips the row via the summary's live query rather than this local state.
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
        {failed ? <Text tone="secondary">{`Couldn’t save to ${HEALTH_STORE}.`}</Text> : null}
        <Island.Button
          fill
          disabled={saving}
          label={saving ? 'Saving…' : `Save to ${HEALTH_STORE}`}
          onPress={save}
        />
      </View>
    </Card>
  );
}
