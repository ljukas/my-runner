import { elevationSource } from './adapter';

export type { AltitudeReading, ElevationSource, MotionPermissionStatus } from './port';

export { elevationSource };

// why memoized, and consulted before every motion-permission touch: iOS raises the Motion & Fitness
// prompt on the first Pedometer call while authorization is undetermined, and on hardware with no
// barometer there is nothing that prompt could serve — no reading can ever arrive (ADR 0015 item 2's
// feature detection). Every simulator is such hardware, so an ungated read strands the whole Maestro
// suite behind a system alert `clearState` cannot dismiss. The answer cannot change within a process.
let barometerAvailable: Promise<boolean> | null = null;
export function hasBarometer(): Promise<boolean> {
  return (barometerAvailable ??= elevationSource.isAvailable().catch(() => false));
}
