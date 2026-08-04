import { describe, expect, test } from 'bun:test';

import { MAX_LOG_BUFFER, RunLog } from './run-log';

function reading(overrides: Partial<Parameters<RunLog['sample']>[0]> = {}) {
  return {
    at: 1_000,
    sensorTimestampS: 10,
    pressureHpa: 1013,
    relativeAltitudeM: 0,
    epoch: 1,
    ...overrides,
  };
}

describe('RunLog', () => {
  test('assigns seq at buffer time so a later drop shows as a gap', () => {
    const log = new RunLog();
    log.sample(reading(), 0, 0);
    log.sample(reading(), 0, 0);
    expect(log.pendingSamples.map((s) => s.seq)).toEqual([0, 1]);
  });

  test('drops a non-finite reading and never buffers it', () => {
    const log = new RunLog();
    log.sample(reading({ pressureHpa: Number.NaN }), 0, 0);
    expect(log.pendingSamples).toHaveLength(0);
  });

  test('a dropped reading still advances nothing, but is counted and logged', () => {
    const log = new RunLog();
    log.sample(reading({ pressureHpa: Number.POSITIVE_INFINITY }), 0, 0);
    expect(log.pendingEntries.some((e) => e.kind === 'samples_dropped')).toBe(true);
  });

  test('offsets epoch by the base so a resumed run is distinguishable from a fresh one', () => {
    const log = new RunLog();
    log.sample(reading({ epoch: 1 }), 0, 3);
    expect(log.pendingSamples[0].epoch).toBe(4);
  });

  test('caps the buffer by dropping the OLDEST instrumentation, and counts each drop', () => {
    const log = new RunLog();
    for (let i = 0; i < MAX_LOG_BUFFER + 5; i += 1) log.sample(reading({ at: i }), 0, 0);
    expect(log.pendingSamples).toHaveLength(MAX_LOG_BUFFER);
    // why the oldest: a cap drop must never cost the newest data, and `at` proves which end went.
    expect(log.pendingSamples[0].at).toBeGreaterThan(0);
    // the count is what the export header reports, so it has to be observable (spec §6.2).
    expect(log.droppedCount).toBe(5);
  });

  test('take() removes what it hands out so a successful flush cannot double-write', () => {
    const log = new RunLog();
    log.sample(reading(), 0, 0);
    const taken = log.takeSamples(10);
    expect(taken).toHaveLength(1);
    expect(log.pendingSamples).toHaveLength(0);
  });

  test('note() serializes its detail with JSON.stringify, which the export format relies on', () => {
    const log = new RunLog();
    log.note('lifecycle', { state: 'background' });
    expect(log.pendingEntries[0].detailJson).toBe('{"state":"background"}');
  });

  test('restoreFrom() continues seq past what is already stored', () => {
    const log = new RunLog();
    log.restoreFrom({ sampleSeq: 450, entrySeq: 1800 });
    log.sample(reading(), 0, 0);
    log.note('tick', null);
    expect(log.pendingSamples[0].seq).toBe(450);
    expect(log.pendingEntries[0].seq).toBe(1800);
  });
});
