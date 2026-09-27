/**
 * Steps across a run, captured only to accompany a barometer capture (ADR 0015). `start()` exists
 * because Android's counter has no history query, so the run's count has to be armed when it
 * begins; where the platform keeps history it does nothing. Never throws.
 */
export interface StepCounterSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Steps in `[start, end)`; null when unavailable (no permission, no hardware, a platform error). */
  read(start: Date, end: Date): Promise<number | null>;
}
