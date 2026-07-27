import { Presets } from 'react-native-pulsar';

import type { Haptics } from './port';

export const haptics: Haptics = {
  confirm: () => {
    // Deliberately not one of ADR 0009's designed cue presets — a bare impact
    // cannot be mistaken for the coach saying something.
    try {
      Presets.System.impactRigid();
    } catch (error) {
      console.warn('[haptics] confirm failed (non-fatal)', error);
    }
  },
};
