import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import type { LocationFix } from '@/domain/geo';
import type { LocationPermissionStatus, LocationTracker } from './port';

const LOCATION_TASK = 'runbro-location-updates';

const listeners = new Set<(fix: LocationFix) => void>();

function warn(context: string, error: unknown): void {
  console.warn(`[location] ${context} (non-fatal)`, error);
}

function toFix({ coords, timestamp }: Location.LocationObject): LocationFix {
  return {
    timestamp,
    lat: coords.latitude,
    lng: coords.longitude,
    altitude: coords.altitude,
    accuracy: coords.accuracy,
    speed: coords.speed,
  };
}

// canAskAgain, not status: still-promptable ⇒ 'undetermined', permanently denied ⇒ 'denied' (route to Settings) — ADR 0008 §2.
function toStatus(res: Location.LocationPermissionResponse): LocationPermissionStatus {
  if (res.granted) return 'granted';
  return res.canAskAgain ? 'undetermined' : 'denied';
}

// Module scope, not a React effect: a headless relaunch must re-arm the heartbeat at bundle-eval (ADR 0008 §4).
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    if (error) {
      warn('task error', error);
      return;
    }
    for (const location of data?.locations ?? []) {
      const fix = toFix(location);
      for (const cb of listeners) {
        try {
          cb(fix);
        } catch (listenerError) {
          warn('fix listener threw', listenerError);
        }
      }
    }
  },
);

export const locationTracker: LocationTracker = {
  async requestPermission() {
    return toStatus(await Location.requestForegroundPermissionsAsync());
  },
  async getPermissionStatus() {
    return toStatus(await Location.getForegroundPermissionsAsync());
  },
  async start() {
    try {
      const { granted } = await Location.getForegroundPermissionsAsync();
      if (!granted) return;
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        activityType: Location.ActivityType.Fitness,
        pausesUpdatesAutomatically: false, // a paused stream stops the heartbeat (ADR 0008 §3)
        showsBackgroundLocationIndicator: true,
        distanceInterval: 0,
      });
    } catch (error) {
      warn('start failed', error);
    }
  },
  async stop() {
    try {
      // stopLocationUpdatesAsync throws on an unregistered task — this guard is what makes stop() idempotent.
      if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      }
    } catch (error) {
      warn('stop failed', error);
    }
  },
  onFix(cb) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};
