import { useRouter } from 'expo-router';
import { useRef } from 'react';

import { Island } from '@/components/island';
import { elevationSource } from '@/services/elevation';
import { fieldTestSession } from '@/services/field-test';
import { runEngine } from '@/services/run-engine';

// why bounded: expo-sensors' PedometerModule.getPermissionsAsync can return without resolving or
// rejecting when its permissions manager is absent (Simulator; see NATIVE_TIMEOUT_MS in
// run-engine/engine.ts) — a stall here must not strand the capture unstarted.
const MOTION_PERMISSION_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, fallback: T, ms: number): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/**
 * The Settings row that starts a field-test capture (spec §8.0) — captures never borrow a plan
 * day (docs/field-test-capture-protocol.md). Settings stays a pure-SwiftUI leaf (ADR 0005 §1): a
 * bare `Island.Button inline` row rather than the Uniwind `Card` its RN siblings
 * (health-status-row, run-export-row) use on the run summary.
 */
export function FieldTestRow() {
  const router = useRouter();
  // why a ref, not state: guards the tap synchronously, before React re-renders with `disabled`
  // set — same idiom as health-status-row's/run-export-row's async-CTA guard.
  const starting = useRef(false);

  const start = () => {
    if (starting.current) return;
    starting.current = true;
    void (async () => {
      // The just-in-time ask, mirroring session/[key].tsx's location prompt: never cold, and a
      // denial (or a stall) still starts the capture — the barometer just stays silent for it
      // (ADR 0015).
      try {
        const status = await withTimeout(
          elevationSource.getPermissionStatus(),
          'undetermined' as const,
          MOTION_PERMISSION_TIMEOUT_MS,
        );
        if (status === 'undetermined') {
          await withTimeout(
            elevationSource.requestPermission(),
            'undetermined' as const,
            MOTION_PERMISSION_TIMEOUT_MS,
          );
        }
      } catch (error) {
        console.warn('[field-test] motion permission ask failed', error);
      }
      runEngine.reset();
      runEngine.start(fieldTestSession());
      router.replace('/run');
    })();
  };

  return <Island.Button inline fill label="Start Field Test" onPress={start} />;
}
