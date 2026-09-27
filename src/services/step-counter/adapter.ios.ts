import { Pedometer } from 'expo-sensors';

import { elevationSource } from '@/services/elevation';
import type { StepCounterSource } from './port';

// why gated on the barometer: the step count exists only to accompany a barometer capture, it
// shares the one Motion & Fitness authorization CMAltimeter needs, and hardware without a barometer
// has no pedometer worth asking either — so the only effect of asking is the prompt. Every simulator
// is such hardware, and that prompt would strand the Maestro suite. Cannot change within a process.
let available: Promise<boolean> | null = null;
function hasBarometer(): Promise<boolean> {
  return (available ??= elevationSource.isAvailable().catch(() => false));
}

export const stepCounterSource: StepCounterSource = {
  // CMPedometer keeps a week of history, so nothing needs arming.
  async start() {},
  async stop() {},

  async read(start, end) {
    if (!(await hasBarometer())) return null;
    // why caught: getStepCountAsync performs no permission check of its own — it rejects when Motion
    // & Fitness isn't authorized — and a finalize that throws is a run that never gets saved.
    try {
      const { steps } = await Pedometer.getStepCountAsync(start, end);
      return steps;
    } catch (error) {
      console.warn('[step-counter] step count read failed', error);
      return null;
    }
  },
};
