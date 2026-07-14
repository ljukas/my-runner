import type { CueId } from '@/domain/cues';

/**
 * Cue production port (ADR 0003, ADR 0009). The engine fires cues by ID on
 * derived-segment change and at milestones (ADR 0007); it never touches
 * expo-speech/expo-audio/haptics directly. The contract speaks IDs, not
 * strings, so the pre-recorded fallback and Android audio-focus variant are
 * drop-in adapter swaps. All methods are fire-and-forget from the engine's
 * synchronous perspective; the adapter owns async work and swallows failures
 * (a failed cue is non-fatal — spec §11).
 */
export interface CueService {
  /** Configure the audio session for the run. Called once at run start. */
  prepare(): void;
  /** Announce a cue. Settings gating and TTS/haptic production are the
   * adapter's concern; the engine announces unconditionally on change. */
  announce(cue: CueId): void;
  /** Stop any in-flight speech and release the audio session. Idempotent. */
  release(): void;
}
