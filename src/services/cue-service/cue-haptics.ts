import { Presets } from 'react-native-pulsar';

import type { CueId } from '@/domain/cues';

/** Meaning-mapped per "Haptics is music" (ADR 0009 §7). On iOS an accent beside speech, on Android the whole cue (ADR 0025 §3). */
export const CUE_HAPTIC: Record<CueId, () => void> = {
  warmupStart: () => Presets.bloom(), // gentle opening
  startRun: () => Presets.charge(), // assertive "go, lift the effort"
  startWalk: () => Presets.breath(), // soft "ease off"
  cooldownStart: () => Presets.afterglow(), // winding down
  halfway: () => Presets.chime(), // a bright progress marker
  lastRun: () => Presets.buildup(), // rising crescendo — finish strong
  complete: () => Presets.applause(), // celebration
  paused: () => Presets.System.impactSoft(),
  resumed: () => Presets.System.impactMedium(),
  resuming: () => Presets.System.impactMedium(),
};
