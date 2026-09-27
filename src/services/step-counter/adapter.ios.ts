import { Pedometer } from 'expo-sensors';

import { hasBarometer } from '@/services/elevation';
import type { StepCounterSource } from './port';

export const stepCounterSource: StepCounterSource = {
  // CMPedometer keeps a week of history, so nothing needs arming.
  async start() {},
  async stop() {},

  async read(start, end) {
    // why gated: the count only accompanies a barometer capture, and it shares CMAltimeter's Motion &
    // Fitness authorization — without a barometer, asking is all prompt and no data.
    if (!(await hasBarometer())) return null;
    // why caught: getStepCountAsync performs no permission check of its own — it rejects when Motion
    // & Fitness isn't authorized — and a finalize that throws is a run that never gets saved.
    // why the port takes Date: getStepCountAsync throws on an ISO string (no .getTime).
    try {
      const { steps } = await Pedometer.getStepCountAsync(start, end);
      return steps;
    } catch (error) {
      console.warn('[step-counter] step count read failed', error);
      return null;
    }
  },
};
