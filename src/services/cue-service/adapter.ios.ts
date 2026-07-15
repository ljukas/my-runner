import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';
import * as Speech from 'expo-speech';
import { AppState } from 'react-native';
import { Presets } from 'react-native-pulsar';

import { CUE_PHRASE, type CueId } from '@/domain/cues';
import type { CueService } from './port';

/**
 * iOS cue adapter (ADR 0003, ADR 0009): expo-speech spoken over a ducked
 * expo-audio session, with a Pulsar haptic accent. Stage 2 is foreground-only —
 * no `shouldPlayInBackground`, no background modes.
 *
 * Haptic accent per cue, chosen from Pulsar's designed preset library and
 * meaning-mapped per Software Mansion's "Haptics is music": crisp/assertive to
 * start running, soft to ease into a walk, a crescendo for the final run, an
 * applause for the finish. Platform-specific, so it lives with the adapter, and
 * it fires only while the app is foreground (ADR 0009 §7).
 */
const CUE_HAPTIC: Record<CueId, () => void> = {
  warmupStart: () => Presets.bloom(), // gentle opening
  startRun: () => Presets.charge(), // assertive "go, lift the effort"
  startWalk: () => Presets.breath(), // soft "ease off"
  cooldownStart: () => Presets.afterglow(), // winding down
  halfway: () => Presets.chime(), // a bright progress marker
  lastRun: () => Presets.buildup(), // rising crescendo — finish strong
  complete: () => Presets.applause(), // celebration
  paused: () => Presets.System.impactSoft(),
  resumed: () => Presets.System.impactMedium(),
};

const warn = (context: string) => (error: unknown) =>
  console.warn(`[cue] ${context} failed (non-fatal)`, error);

// Music ducks only around each utterance (ADR 0009 §3): the session activates
// when a cue speaks and is deactivated a short beat after it finishes, so
// back-to-back cues (a milestone landing on a transition) don't flap it and the
// "stuck ducked" bug class (expo#19042) is designed out.
const RELEASE_DEBOUNCE_MS = 500;
let pendingRelease: ReturnType<typeof setTimeout> | null = null;

function cancelPendingRelease(): void {
  if (pendingRelease) {
    clearTimeout(pendingRelease);
    pendingRelease = null;
  }
}

function scheduleRelease(): void {
  cancelPendingRelease();
  pendingRelease = setTimeout(() => {
    pendingRelease = null;
    void setIsAudioActiveAsync(false).catch(warn('deactivate'));
  }, RELEASE_DEBOUNCE_MS);
}

export const cueService: CueService = {
  prepare() {
    void setAudioModeAsync({
      playsInSilentMode: true, // the silent switch can't mute coaching cues
      interruptionMode: 'duckOthers', // music dips, keeps playing, recovers
      // No shouldPlayInBackground in Stage 2 — locked-screen cues are Stage 3.
    }).catch(warn('prepare'));
  },

  // `cue` is already resolved and gated by the composition seam (index.ts); the
  // adapter just produces the speech + haptic for it.
  announce(cue: CueId) {
    cancelPendingRelease();
    void setIsAudioActiveAsync(true).catch(warn('activate'));
    try {
      Speech.speak(CUE_PHRASE[cue], {
        onDone: scheduleRelease,
        onError: scheduleRelease,
        onStopped: scheduleRelease,
      });
    } catch (error) {
      warn('speak')(error);
      scheduleRelease();
    }

    // Haptic accent rides the same cue, but only while foreground.
    if (AppState.currentState === 'active') {
      try {
        CUE_HAPTIC[cue]();
      } catch (error) {
        warn('haptic')(error);
      }
    }
  },

  release() {
    cancelPendingRelease();
    void Speech.stop().catch(warn('stop'));
    void setIsAudioActiveAsync(false).catch(warn('release'));
  },
};
