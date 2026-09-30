import { describe, expect, test } from 'bun:test';

import type { ResumableRun } from './index';
import {
  beginResumeCheck,
  clearResumeOffer,
  getResumeGate,
  peekResumeOffer,
  setResumeOffer,
  settleResumeCheck,
  subscribeResumeGate,
} from './resume-offer';

const candidate = { runId: 'r' } as unknown as ResumableRun;

describe('the resume gate', () => {
  test('is checking until a check settles, so nothing can start behind an offer', () => {
    expect(getResumeGate()).toBe('checking');
    expect(beginResumeCheck()).toBe(true);
    expect(beginResumeCheck()).toBe(false);
    expect(getResumeGate()).toBe('checking');
  });

  test('an offer holds it until the offer is decided, and tells its subscribers each time', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeResumeGate(() => seen.push(getResumeGate()));
    setResumeOffer(candidate);
    expect(peekResumeOffer()).toBe(candidate);
    expect(getResumeGate()).toBe('offered');
    clearResumeOffer();
    expect(peekResumeOffer()).toBeNull();
    expect(getResumeGate()).toBe('clear');
    unsubscribe();
    settleResumeCheck();
    expect(seen).toEqual(['offered', 'clear']);
  });
});
