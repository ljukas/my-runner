import { describe, expect, test } from 'bun:test';

import {
  CUE_CATEGORY,
  CUE_IDS,
  CUE_PHRASE,
  SEGMENT_ENTRY_CUE,
  effectiveCue,
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
});

describe('effectiveCue gating', () => {
  test('interval cues are suppressed when interval cues are off', () => {
    expect(effectiveCue('startRun', MILESTONE_ONLY)).toBeNull();
    expect(effectiveCue('startWalk', MILESTONE_ONLY)).toBeNull();
    expect(effectiveCue('warmupStart', MILESTONE_ONLY)).toBeNull();
    expect(effectiveCue('paused', MILESTONE_ONLY)).toBeNull();
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
