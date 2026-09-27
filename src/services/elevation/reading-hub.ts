import type { AltitudeReading } from './port';

/** The JS fan-out both adapters put behind their single native subscription. */
export function createReadingHub() {
  const listeners = new Set<(reading: AltitudeReading) => void>();
  let epoch = 0;
  return {
    nextEpoch: () => ++epoch,
    emit(reading: AltitudeReading) {
      // why a snapshot: a listener added from inside another listener's callback must not be
      // visited in this same delivery — iterating the live Set would do exactly that.
      Array.from(listeners).forEach((listener) => listener(reading));
    },
    onReading(cb: (reading: AltitudeReading) => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
