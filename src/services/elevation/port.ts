export interface AltitudeReading {
  /** Receipt wall clock, epoch ms — not monotonic; pair with `sensorTimestampS`. */
  at: number;
  /** CoreMotion's boot-relative clock, seconds. Monotonic. */
  sensorTimestampS: number | null;
  pressureHpa: number;
  relativeAltitudeM: number | null;
  epoch: number;
}

export type MotionPermissionStatus = 'granted' | 'denied' | 'undetermined';

/**
 * Elevation source (ADR 0015). Denial degrades, never blocks: with permission ungranted no
 * readings arrive, yet the run is unaffected — ADR 0008 §5's rule, applied to a second sensor.
 */
export interface ElevationSource {
  isAvailable(): Promise<boolean>;
  requestPermission(): Promise<MotionPermissionStatus>;
  getPermissionStatus(): Promise<MotionPermissionStatus>;
  /** Owns the single native subscription. Idempotent — a second call while running does nothing. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Registers into a JS fan-out; never touches the native subscription. */
  onReading(cb: (reading: AltitudeReading) => void): () => void;
}
