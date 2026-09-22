import Storage from 'expo-sqlite/kv-store';
import { AppState } from 'react-native';
import {
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  insertRecords,
  requestPermission,
  SdkAvailabilityStatus,
} from 'react-native-health-connect';

import type { HealthWorkoutInput } from '@/domain/health';
import { notifyAuthorizationChanged } from './authorization-events';
import {
  resolveAuthorization,
  toDistanceRecord,
  toExerciseSessionRecord,
  WRITE_PERMISSIONS,
} from './health-connect';
import type { HealthAdapter, HealthAuthorization } from './port';

// Health Connect never says "denied", only "not granted" — this is the app's own memory of having
// asked, which is what turns a missing grant into 'denied' (Settings then offers the Health
// Connect route rather than a prompt Health Connect would auto-decline after two refusals).
const REQUESTED_KEY = 'health.writeAccessRequested';

// why cached: the port's getAuthorization() is synchronous (ADR 0011, Android amendment) and every
// Health Connect status call is async. Starts pessimistic so nothing is offered or written before
// the first probe resolves — which it does during startup, before any screen mounts.
let cached: HealthAuthorization = 'unavailable';

async function sdkAvailable(): Promise<boolean> {
  return (await getSdkStatus()) === SdkAvailabilityStatus.SDK_AVAILABLE;
}

async function probe(): Promise<HealthAuthorization> {
  if (!(await sdkAvailable())) return 'unavailable';
  await initialize();
  return resolveAuthorization({
    sdkAvailable: true,
    granted: await getGrantedPermissions(),
    requested: Storage.getItemSync(REQUESTED_KEY) !== null,
  });
}

function update(next: HealthAuthorization): HealthAuthorization {
  if (next !== cached) {
    cached = next;
    notifyAuthorizationChanged();
  }
  return cached;
}

function refresh(): void {
  probe()
    .then(update)
    .catch((error: unknown) => console.warn('[health] status probe failed', error));
}

refresh();
// Grants change in the Health Connect app, which suspends us rather than remounting anything.
AppState.addEventListener('change', (state) => {
  if (state === 'active') refresh();
});

export const healthAdapter: HealthAdapter = {
  getAuthorization: () => cached,

  async requestWriteAccess(): Promise<HealthAuthorization> {
    if (!(await sdkAvailable())) return update('unavailable');
    await initialize();
    Storage.setItemSync(REQUESTED_KEY, '1');
    const granted = await requestPermission([...WRITE_PERMISSIONS]);
    return update(resolveAuthorization({ sdkAvailable: true, granted, requested: true }));
  },

  async saveRun(input: HealthWorkoutInput): Promise<void> {
    await initialize();
    // why Date.now(): as on iOS — Health Connect keeps the record with the highest
    // clientRecordVersion for a repeated clientRecordId, so a retry replaces only if it rises.
    const version = Date.now();
    await insertRecords([toExerciseSessionRecord(input, version)]);
    const distance = toDistanceRecord(input, version);
    // why two calls: insertRecords rejects a batch that mixes record types.
    if (distance) await insertRecords([distance]);
  },
};
