import { requireNativeModule } from 'expo';

/** Transient may-duck audio focus for spoken cues (ADR 0009). Both calls are idempotent. */
interface AudioFocusModule {
  /** Whether focus was granted; speech proceeds either way — only the ducking is at stake. */
  request(): boolean;
  abandon(): void;
}

export const AudioFocus = requireNativeModule<AudioFocusModule>('AudioFocus');
