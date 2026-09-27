import { Pedometer } from 'expo-sensors';
import { AppState } from 'react-native';

import { MotionSensors } from '@/modules/motion-sensors';
import type { StepCounterSource } from './port';
import { stepsBetween } from './reading';

// Counts from our own module's registration: expo-sensors' getStepCountAsync is unimplemented on
// Android, but its permission calls are the ACTIVITY_RECOGNITION ask this counter needs.
let armed = false;

function register(): void {
  if (armed) MotionSensors.startSteps();
}

export const stepCounterSource: StepCounterSource = {
  async start() {
    if (armed) return;
    armed = true;
    if (!MotionSensors.hasStepCounter()) return;
    const { granted, canAskAgain } = await Pedometer.getPermissionsAsync();
    if (granted) return register();
    // why only in the foreground: a crash-resume can restore a run with no Activity to host the
    // dialog. Not awaited, so a dialog left open cannot hold the engine's sensor chain.
    if (!canAskAgain || AppState.currentState !== 'active') return;
    void Pedometer.requestPermissionsAsync()
      .then((status) => {
        if (status.granted) register();
      })
      .catch((error) => console.warn('[step-counter] activity permission ask failed', error));
  },

  async stop() {
    armed = false;
    MotionSensors.stopSteps();
  },

  // The dates go unused: this registration began at the run's start(), so its spread is the run.
  // A crash-resume re-arms at the resume, so a resumed run counts only its steps since then.
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
