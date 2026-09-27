import { AppState } from 'react-native';

import { MotionSensors } from '@/modules/motion-sensors';
import { elevationSource, hasBarometer } from '@/services/elevation';
import type { StepCounterSource } from './port';
import { stepsBetween } from './reading';

// expo-sensors' getStepCountAsync is unimplemented on Android, so counting is our module's; the
// ACTIVITY_RECOGNITION ask stays the elevation port's, whose motion permission this is.
// why `armed` is re-checked in register(): an abandoned start() may settle after stop() (port.ts).
let armed = false;

function register(): void {
  if (armed) MotionSensors.startSteps();
}

export const stepCounterSource: StepCounterSource = {
  async start() {
    if (armed) return;
    armed = true;
    // why gated: the count only accompanies a barometer capture (as on iOS), so on a phone without
    // one the ACTIVITY_RECOGNITION dialog would ask for data nothing records alongside.
    if (!(await hasBarometer()) || !MotionSensors.hasStepCounter()) return;
    const status = await elevationSource.getPermissionStatus();
    if (status === 'granted') return register();
    // why only in the foreground: a crash-resume can restore a run with no Activity to host the
    // dialog. Not awaited, so a dialog left open cannot hold the engine's sensor chain.
    if (status === 'denied' || AppState.currentState !== 'active') return;
    void elevationSource
      .requestPermission()
      .then((next) => {
        if (next === 'granted') register();
      })
      .catch((error) => console.warn('[step-counter] activity permission ask failed', error));
  },

  async stop() {
    armed = false;
    MotionSensors.stopSteps();
  },

  // The dates go unused: this registration began at the run's start(). A crash-resume re-arms at
  // the resume, so a resumed run counts only its steps since then — the port allows that.
  async read() {
    try {
      const counts = MotionSensors.stepCounts();
      return counts && stepsBetween(counts.first, counts.latest);
    } catch (error) {
      console.warn('[step-counter] step count read failed', error);
      return null;
    }
  },
};
