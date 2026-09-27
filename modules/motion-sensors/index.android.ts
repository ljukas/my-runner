import { requireNativeModule } from 'expo';

interface MotionSensorsModule {
  hasBarometer(): boolean;
  /** Whether the listener is registered; idempotent. Readings arrive as `onPressure` at ~1 Hz. */
  startBarometer(): boolean;
  stopBarometer(): void;
  hasStepCounter(): boolean;
  /** False without ACTIVITY_RECOGNITION; idempotent, and a fresh registration clears the counts. */
  startSteps(): boolean;
  stopSteps(): void;
  /** The counter's first and latest values since startSteps(); null before its first event. */
  stepCounts(): { first: number; latest: number } | null;
  addListener(
    event: 'onPressure',
    listener: (event: { pressureHpa: number; timestampS: number }) => void,
  ): { remove(): void };
}

export const MotionSensors = requireNativeModule<MotionSensorsModule>('MotionSensors');
