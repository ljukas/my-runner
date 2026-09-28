import { AppState } from 'react-native';

import type { CueId } from '@/domain/cues';
import { CUE_HAPTIC } from './cue-haptics';
import type { CueService } from './port';

// Android stage 1 cues are haptic only (ADR 0025): no speech, so no audio session to prepare or
// release. Foreground-gated like the iOS accent — a vibration with the screen off would be a cue
// the runner cannot place.
export const cueService: CueService = {
  prepare() {},

  announce(cue: CueId) {
    if (AppState.currentState !== 'active') return;
    try {
      CUE_HAPTIC[cue]();
    } catch (error) {
      console.warn('[cue] haptic failed (non-fatal)', error);
    }
  },

  release() {},
};
