/** Steps across a run, captured only to accompany a barometer capture (ADR 0015). Never throws. */
export interface StepCounterSource {
  /**
   * Called as a run begins or resumes; without history, the count starts here. May be abandoned at
   * the engine's timeout, so a later stop() must win over a start() that settles after it.
   */
  start(): Promise<void>;
  stop(): Promise<void>;
  /**
   * Steps in `[start, end)` where the platform keeps history, otherwise since the latest `start()`
   * (so a resumed run counts from its resume). Null when unavailable: no permission, no hardware, a
   * platform error, or a counter reset mid-run. Dates, not ISO strings: getStepCountAsync throws
   * on a string.
   */
  read(start: Date, end: Date): Promise<number | null>;
}
