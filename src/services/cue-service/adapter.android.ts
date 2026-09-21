import { setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';
import { AppState } from 'react-native';

import { CUE_PHRASE, type CueId } from '@/domain/cues';
import { AudioFocus } from '@/modules/audio-focus';
import { CUE_HAPTIC } from './cue-haptics';
import type { CueService } from './port';
import { createReleaseScheduler } from './release-scheduler';

const warn = (context: string) => (error: unknown) =>
  console.warn(`[cue] ${context} failed (non-fatal)`, error);

// The phrases are English (ADR 0009); without this the engine reads them in the device locale's
// voice — SpeechModule.kt falls back to Locale.getDefault().
const SPEECH_LANGUAGE = 'en-US';

// Focus request/abandon stands in for the iOS session; same scheduler and last-in-flight rule
// (ADR 0009, 2026-09-21 amendment; TextToSpeech queues with QUEUE_ADD like AVSpeechSynthesizer).
const releaseScheduler = createReleaseScheduler({
  debounceMs: 0,
  // why: run the release synchronously — RN suspends JS timers while the activity is paused, so a
  // deferred abandon left music ducked until the screen came back on (ADR 0009 amendment, bullet 2).
  setTimeoutFn: (fn) => {
    fn();
    return null;
  },
  clearTimeoutFn: () => {},
  release: () => abandonFocus('abandon'),
});

function abandonFocus(context: string): void {
  try {
    AudioFocus.abandon();
  } catch (error) {
    warn(context)(error);
  }
}

export const cueService: CueService = {
  prepare() {
    releaseScheduler.reset();
    // Inert for speech on Android (it only configures expo-audio's own players) — kept so both
    // adapters read from the one session table in ADR 0009 §2.
    void setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
      shouldPlayInBackground: true,
    }).catch(warn('prepare'));
    // Any call that touches the lazy TextToSpeech instantiates it, and that is where Google TTS's
    // engine-init delay is paid; paying it here keeps the warm-up cue from being the utterance
    // that waits (SpeechModule.kt queues utterances until onInit).
    void Speech.isSpeakingAsync().catch(warn('warm-up'));
  },

  announce(cue: CueId) {
    releaseScheduler.begin();
    try {
      if (!AudioFocus.request()) warn('focus')('not granted');
    } catch (error) {
      warn('focus')(error);
    }
    try {
      Speech.speak(CUE_PHRASE[cue], {
        language: SPEECH_LANGUAGE,
        onDone: () => releaseScheduler.end(),
        onError: () => releaseScheduler.end(),
        onStopped: () => releaseScheduler.end(),
      });
    } catch (error) {
      warn('speak')(error);
      releaseScheduler.end();
    }

    // Haptic accent only while foreground (ADR 0009 §7) — one rule on both platforms.
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
    // Abandon only after the native stop resolves, and not if a new run started announcing in the
    // meantime (its own begin/end cycle owns the focus now) — the same guard as iOS.
    void Speech.stop()
      .catch(warn('stop'))
      .finally(() => {
        if (releaseScheduler.isIdle()) abandonFocus('release');
      });
  },
};
