import { describe, expect, test } from 'bun:test';

import {
  formatRollingPace,
  freeRunLocationLine,
  freeRunPhase,
  showsRunMetrics,
} from './free-run-view';

describe('freeRunPhase', () => {
  const moving = { motion: 'run' as const, gpsStale: false, location: 'granted' as const };

  test('names the bucket the classifier sees', () => {
    expect(freeRunPhase(moving)).toEqual({ look: 'run', label: 'Running' });
    expect(freeRunPhase({ ...moving, motion: 'walk' })).toEqual({ look: 'walk', label: 'Walking' });
    expect(freeRunPhase({ ...moving, motion: 'stopped' })).toEqual({
      look: 'stopped',
      label: 'Stopped',
    });
  });

  test('without location it is timer only, whatever the classifier last saw', () => {
    for (const location of ['denied', 'undetermined', 'unsupported'] as const) {
      expect(freeRunPhase({ ...moving, location })).toEqual({
        look: 'timerOnly',
        label: 'Timer only',
      });
    }
  });

  test('waits for GPS while speed is stale or the first kind is not yet confirmed', () => {
    const waiting = { look: 'waiting', label: 'Waiting for GPS' } as const;
    expect(freeRunPhase({ ...moving, gpsStale: true })).toEqual(waiting);
    expect(freeRunPhase({ ...moving, motion: null })).toEqual(waiting);
  });

  test('a permission not yet read is not timer only', () => {
    expect(freeRunPhase({ ...moving, location: null })).toEqual({ look: 'run', label: 'Running' });
  });
});

describe('showsRunMetrics', () => {
  test('shows distance and pace whenever they can move, or already have', () => {
    expect(showsRunMetrics('granted', 0)).toBe(true);
    expect(showsRunMetrics('denied', 0)).toBe(false);
    expect(showsRunMetrics(null, 0)).toBe(false);
    expect(showsRunMetrics('denied', 120)).toBe(true);
  });
});

describe('formatRollingPace', () => {
  test('a dash with no pace, the usual pace otherwise', () => {
    expect(formatRollingPace(null)).toBe('—');
    expect(formatRollingPace(342)).toBe('5:42 /km');
  });
});

describe('freeRunLocationLine', () => {
  test('says what the run will record', () => {
    expect(freeRunLocationLine('granted')).toMatch(/distance, pace and route/);
    expect(freeRunLocationLine('undetermined')).toMatch(/asked when you start/);
    expect(freeRunLocationLine(null)).toMatch(/asked when you start/);
    expect(freeRunLocationLine('denied')).toMatch(/timer only/);
    expect(freeRunLocationLine('unsupported')).toMatch(/timer only/);
  });
});
