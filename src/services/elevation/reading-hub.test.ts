import { describe, expect, test } from 'bun:test';

import type { AltitudeReading } from './port';
import { createReadingHub } from './reading-hub';

const reading: AltitudeReading = {
  at: 0,
  sensorTimestampS: 0,
  pressureHpa: 1013,
  relativeAltitudeM: 0,
  epoch: 1,
};

describe('createReadingHub', () => {
  test('a listener added during a delivery waits for the next one', () => {
    const hub = createReadingHub();
    const late: AltitudeReading[] = [];
    hub.onReading(() => hub.onReading((r) => late.push(r)));
    hub.emit(reading);
    expect(late).toHaveLength(0);
    hub.emit(reading);
    expect(late).toHaveLength(1);
  });

  test('an unsubscribed listener hears nothing more', () => {
    const hub = createReadingHub();
    const heard: AltitudeReading[] = [];
    const off = hub.onReading((r) => heard.push(r));
    off();
    hub.emit(reading);
    expect(heard).toHaveLength(0);
  });

  test('epochs increase per call', () => {
    const hub = createReadingHub();
    expect(hub.nextEpoch()).toBe(1);
    expect(hub.nextEpoch()).toBe(2);
  });
});
