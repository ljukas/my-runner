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
  test('assigns sequential seq to each buffered sample', () => {
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
    expect(log.pendingEntries).toHaveLength(1);
    expect(log.pendingEntries[0].kind).toBe('samples_dropped');
    expect(log.pendingEntries[0].detailJson).toBe('{"reason":"nonfinite","total":1}');
  });

  test('a dropped reading still consumes a seq, so the next sample shows the gap', () => {
    const log = new RunLog();
    log.sample(reading(), 0, 0); // seq 0
    log.sample(reading({ pressureHpa: Number.NaN }), 0, 0); // consumes seq 1, dropped
    log.sample(reading(), 0, 0); // seq 2
    expect(log.pendingSamples.map((s) => s.seq)).toEqual([0, 2]);
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
    // why exactly 5, not just >0: pins the off-by-one — the 5 oldest (at: 0..4) went, at: 5 is
    // the new oldest survivor.
    expect(log.pendingSamples[0].at).toBe(5);
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

  test('restoreSamples() puts a taken batch back with seq untouched, ahead of anything buffered since', () => {
    const log = new RunLog();
    log.sample(reading({ at: 1 }), 0, 0); // seq 0
    log.sample(reading({ at: 2 }), 0, 0); // seq 1
    const taken = log.takeSamples(10);
    log.sample(reading({ at: 3 }), 0, 0); // seq 2, buffered while the flush was in flight
    log.restoreSamples(taken);
    expect(log.pendingSamples.map((s) => s.seq)).toEqual([0, 1, 2]);
  });

  test('restoreEntries() puts a taken batch back with seq untouched, ahead of anything buffered since', () => {
    const log = new RunLog();
    log.note('tick', null); // seq 0
    const taken = log.takeEntries(10);
    log.note('tick', null); // seq 1, buffered while the flush was in flight
    log.restoreEntries(taken);
    expect(log.pendingEntries.map((e) => e.seq)).toEqual([0, 1]);
  });

  test('restoreSamples() past the cap drops from the oldest end and counts the drops', () => {
    const log = new RunLog();
    for (let i = 0; i < MAX_LOG_BUFFER; i += 1) log.sample(reading({ at: i }), 0, 0);
    const taken = log.takeSamples(MAX_LOG_BUFFER); // seq 0..MAX_LOG_BUFFER-1, buffer now empty
    log.sample(reading({ at: -1 }), 0, 0); // seq MAX_LOG_BUFFER, buffered during the failed flush
    log.restoreSamples(taken); // merged length MAX_LOG_BUFFER + 1 -> oldest (seq 0) is dropped
    expect(log.pendingSamples).toHaveLength(MAX_LOG_BUFFER);
    expect(log.pendingSamples[0].seq).toBe(1);
    expect(log.droppedCount).toBe(1);
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
