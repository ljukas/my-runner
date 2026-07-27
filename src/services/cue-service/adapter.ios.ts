import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';
import * as Speech from 'expo-speech';
import { AppState } from 'react-native';
import { Presets } from 'react-native-pulsar';

import { CUE_PHRASE, type CueId } from '@/domain/cues';
import type { CueService } from './port';
import { createReleaseScheduler, RELEASE_DEBOUNCE_MS } from './release-scheduler';

/**
 * iOS cue adapter (ADR 0003, ADR 0009): expo-speech spoken over a ducked
 * expo-audio session, with a Pulsar haptic accent.
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
  resuming: () => Presets.System.impactMedium(),
};

const warn = (context: string) => (error: unknown) =>
  console.warn(`[cue] ${context} failed (non-fatal)`, error);

// Music ducks only around utterances (ADR 0009 §3): the session activates when
// a cue speaks and is deactivated a short beat after the LAST in-flight
// utterance finishes — not after each one. A milestone can land on a
// transition (W3: halfway is exactly a walk→run boundary — issue #41), which
// queues the second utterance inside the shared AVSpeechSynthesizer;
// deactivating the session mid-queue wedges the synthesizer and silences every
// later cue. The debounce keeps multi-phrase moments from flapping the
// session, and the "stuck ducked" bug class (expo#19042) stays designed out
// via release()'s unconditional teardown.
const releaseScheduler = createReleaseScheduler({
  debounceMs: RELEASE_DEBOUNCE_MS,
  release: () => void setIsAudioActiveAsync(false).catch(warn('deactivate')),
});

export const cueService: CueService = {
  prepare() {
    // Run-start normalization: a counter leaked by a lost terminal callback in
    // a previous run must never keep this run's session ducked.
    releaseScheduler.reset();
    void setAudioModeAsync({
      playsInSilentMode: true, // the silent switch can't mute coaching cues
      interruptionMode: 'duckOthers', // music dips, keeps playing, recovers
      shouldPlayInBackground: true, // cues stay audible while the phone is locked (ADR 0008)
    }).catch(warn('prepare'));
  },

  // `cue` is already resolved and gated by the composition seam (index.ts); the
  // adapter just produces the speech + haptic for it.
  announce(cue: CueId) {
    releaseScheduler.begin();
    void setIsAudioActiveAsync(true).catch(warn('activate'));
    try {
      Speech.speak(CUE_PHRASE[cue], {
        onDone: () => releaseScheduler.end(),
        onError: () => releaseScheduler.end(),
        onStopped: () => releaseScheduler.end(),
      });
    } catch (error) {
      warn('speak')(error);
      releaseScheduler.end();
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
    releaseScheduler.reset();
    // Deactivate only after the native stop resolves — deactivating while the
    // synthesizer is still rendering is the same defect class as issue #41 —
    // and skip it if a new run started announcing in the meantime (its own
    // begin/end cycle now owns the session).
    void Speech.stop()
      .catch(warn('stop'))
      .finally(() => {
        if (releaseScheduler.isIdle()) void setIsAudioActiveAsync(false).catch(warn('release'));
      });
  },
};
