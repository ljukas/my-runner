import { describe, expect, test } from 'bun:test';

import {
  CUE_CATEGORY,
  CUE_IDS,
  CUE_PHRASE,
  SEGMENT_ENTRY_CUE,
  cuePhrase,
  effectiveCue,
  kilometrePhrase,
  type CueId,
} from './cues';
import type { SegmentKind } from './plan';

const ALL_ON = { intervalCues: true, milestoneCues: true };
const ALL_OFF = { intervalCues: false, milestoneCues: false };
const INTERVAL_ONLY = { intervalCues: true, milestoneCues: false };
const MILESTONE_ONLY = { intervalCues: false, milestoneCues: true };

describe('cue tables', () => {
  test('every cue has a phrase and a category', () => {
    for (const cue of CUE_IDS) {
      expect(typeof CUE_PHRASE[cue]).toBe('string');
      expect(CUE_PHRASE[cue].length).toBeGreaterThan(0);
      expect(['interval', 'milestone']).toContain(CUE_CATEGORY[cue]);
    }
  });

  test('warm-up and cool-down phrases name the walk (design decision)', () => {
    expect(CUE_PHRASE.warmupStart.toLowerCase()).toContain('walk');
    expect(CUE_PHRASE.cooldownStart.toLowerCase()).toContain('walk');
  });

  test('each segment kind maps to its entry cue', () => {
    const expected: Record<SegmentKind, CueId> = {
      warmup: 'warmupStart',
      run: 'startRun',
      walk: 'startWalk',
      cooldown: 'cooldownStart',
    };
    expect(SEGMENT_ENTRY_CUE).toEqual(expected);
  });

  test('the resuming cue carries the crash-recovery phrase (spec §6)', () => {
    expect(CUE_PHRASE.resuming).toBe('Resuming your workout.');
    expect(CUE_CATEGORY.resuming).toBe('interval');
  });
});

describe('effectiveCue gating', () => {
  test('interval cues are suppressed when interval cues are off', () => {
    expect(effectiveCue('startRun', MILESTONE_ONLY)).toBeNull();
    expect(effectiveCue('startWalk', MILESTONE_ONLY)).toBeNull();
    expect(effectiveCue('warmupStart', MILESTONE_ONLY)).toBeNull();
    expect(effectiveCue('paused', MILESTONE_ONLY)).toBeNull();
  });

  test('resuming follows the interval toggle', () => {
    expect(effectiveCue('resuming', INTERVAL_ONLY)).toBe('resuming');
    expect(effectiveCue('resuming', MILESTONE_ONLY)).toBeNull();
  });

  test('milestone cues are suppressed when milestone cues are off', () => {
    expect(effectiveCue('halfway', INTERVAL_ONLY)).toBeNull();
    expect(effectiveCue('complete', INTERVAL_ONLY)).toBeNull();
  });

  test('a cue returns itself when its category is enabled', () => {
    expect(effectiveCue('startRun', ALL_ON)).toBe('startRun');
    expect(effectiveCue('halfway', ALL_ON)).toBe('halfway');
    expect(effectiveCue('complete', ALL_ON)).toBe('complete');
  });

  test('everything is suppressed when both toggles are off', () => {
    for (const cue of CUE_IDS) {
      expect(effectiveCue(cue, ALL_OFF)).toBeNull();
    }
  });

  test('lastRun resolves to itself when milestone cues are on', () => {
    expect(effectiveCue('lastRun', ALL_ON)).toBe('lastRun');
    expect(effectiveCue('lastRun', MILESTONE_ONLY)).toBe('lastRun');
  });

  test('lastRun falls back to startRun when only interval cues are on', () => {
    expect(effectiveCue('lastRun', INTERVAL_ONLY)).toBe('startRun');
  });

  test('lastRun is suppressed when both toggles are off', () => {
    expect(effectiveCue('lastRun', ALL_OFF)).toBeNull();
  });

  test('the resolved cue always maps to a real phrase', () => {
    for (const cue of CUE_IDS) {
      const eff = effectiveCue(cue, ALL_ON);
      expect(eff).not.toBeNull();
      expect(CUE_PHRASE[eff as CueId]).toBeTruthy();
    }
  });
});

describe('the kilometre cue (ADR 0026 §7)', () => {
  test('is a milestone, gated by the milestone toggle alone', () => {
    expect(CUE_CATEGORY.kilometre).toBe('milestone');
    expect(effectiveCue('kilometre', MILESTONE_ONLY)).toBe('kilometre');
    expect(effectiveCue('kilometre', INTERVAL_ONLY)).toBeNull();
  });

  test.each([
    [1, 400, '1 kilometre. 6 minutes 40 per kilometre.'],
    [2, 400, '2 kilometres. 6 minutes 40 per kilometre.'],
    [3, 360, '3 kilometres. 6 minutes per kilometre.'],
    [1, 60, '1 kilometre. 1 minute per kilometre.'],
    [1, 65, '1 kilometre. 1 minute 5 per kilometre.'],
    [4, 359.6, '4 kilometres. 6 minutes per kilometre.'],
    [4, 359.4, '4 kilometres. 5 minutes 59 per kilometre.'],
  ])('%i km at %d s/km reads "%s"', (km, pace, phrase) => {
    expect(kilometrePhrase({ km, paceSecPerKm: pace })).toBe(phrase);
  });

  test('an unknown or implausible pace is left out', () => {
    expect(kilometrePhrase({ km: 2, paceSecPerKm: null })).toBe('2 kilometres.');
    expect(kilometrePhrase({ km: 2, paceSecPerKm: Number.POSITIVE_INFINITY })).toBe(
      '2 kilometres.',
    );
    expect(kilometrePhrase({ km: 2, paceSecPerKm: 45 })).toBe('2 kilometres.');
  });

  test('cuePhrase speaks the data for a kilometre and the fixed phrase otherwise', () => {
    expect(cuePhrase('kilometre', { km: 1, paceSecPerKm: 400 })).toBe(
      '1 kilometre. 6 minutes 40 per kilometre.',
    );
    expect(cuePhrase('kilometre')).toBe('Kilometre.');
    expect(cuePhrase('halfway')).toBe(CUE_PHRASE.halfway);
  });
});
