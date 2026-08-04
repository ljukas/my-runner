import { describe, expect, test } from 'bun:test';

import { RUN_EXPORT_MAGIC, toRunExport, type RunExportInput } from './run-export';

function input(overrides: Partial<RunExportInput> = {}): RunExportInput {
  return {
    exportedAt: '2026-08-04T10:00:00.000Z',
    device: {
      deviceName: "Lukas's iPhone",
      osVersion: '26.5',
      appVersion: '0.1.0',
      updateId: null,
      barometerAvailable: true,
      motionPermission: 'granted',
      timezoneOffsetMin: -120,
    },
    run: {
      id: 'run-1',
      sessionKey: 'w1d1',
      status: 'completed',
      startedAt: '2026-08-04T09:00:00.000Z',
      endedAt: '2026-08-04T09:30:00.000Z',
      activeDurationS: 1800,
      distanceM: 2760.5,
    },
    segments: [
      {
        seq: 0,
        kind: 'warmup',
        plannedDurationS: 300,
        actualDurationS: 301,
        distanceM: 400,
        wasSkipped: false,
      },
    ],
    points: [
      {
        seq: 0,
        at: '2026-08-04T09:00:01.000Z',
        lat: 59.329323,
        lng: 18.068581,
        altitudeM: 12.25,
        accuracyM: 5,
        altitudeAccuracyM: -1,
        speedMps: 2.1,
        segmentSeq: 0,
      },
    ],
    samples: [
      {
        seq: 0,
        at: '2026-08-04T09:00:02.000Z',
        sensorTimestampS: 12345.678,
        pressureHpa: 1013.257,
        relativeAltitudeM: 0,
        epoch: 1,
        segmentSeq: 0,
      },
    ],
    log: [
      { seq: 0, at: '2026-08-04T09:00:00.500Z', kind: 'sensor', detailJson: '{"available":true}' },
    ],
    events: [{ at: 1_000_000, type: 'start' }],
    ...overrides,
  };
}

describe('toRunExport', () => {
  test('opens with the magic line and a single-line JSON header carrying counts', () => {
    const lines = toRunExport(input()).split('\n');
    expect(lines[0]).toBe(`# ${RUN_EXPORT_MAGIC}`);
    const header = JSON.parse(lines[1]) as { counts: Record<string, number> };
    expect(header.counts).toEqual({ segments: 1, points: 1, altitude: 1, log: 1, events: 1 });
  });

  test('the device header carries a name, not a hardware model field', () => {
    const lines = toRunExport(input()).split('\n');
    const header = JSON.parse(lines[1]) as { device: Record<string, unknown> };
    expect(header.device.deviceName).toBe("Lukas's iPhone");
    expect(header.device).not.toHaveProperty('model');
  });

  test('emits every section header even when a section is empty, with no row leaked into its body', () => {
    const text = toRunExport(input({ samples: [], points: [] }));
    const pointsBody = text
      .slice(text.indexOf('## points'), text.indexOf('## altitude'))
      .split('\n')
      .filter(Boolean);
    const altitudeBody = text
      .slice(text.indexOf('## altitude'), text.indexOf('## log'))
      .split('\n')
      .filter(Boolean);
    expect(pointsBody).toEqual([
      '## points',
      'seq,at,lat,lng,altitudeM,accuracyM,altitudeAccuracyM,speedMps,segmentSeq',
    ]);
    expect(altitudeBody).toEqual([
      '## altitude',
      'seq,at,sensorTimestampS,pressureHpa,relativeAltitudeM,epoch,segmentSeq',
    ]);
  });

  test('numbers round-trip exactly — toFixed anywhere here would cost 0.83 m per 1 dp of pressure', () => {
    // Precision exceeds any plausible fixed-decimal count a toFixed(n) could coincidentally match,
    // and each assertion is the complete CSV row, not a substring a rounded value could also satisfy.
    const text = toRunExport(
      input({
        points: [
          {
            seq: 0,
            at: '2026-08-04T09:00:01.000Z',
            lat: 59.32932312345,
            lng: 18.068581,
            altitudeM: 12.25,
            accuracyM: 5,
            altitudeAccuracyM: -1,
            speedMps: 2.1,
            segmentSeq: 0,
          },
        ],
        samples: [
          {
            seq: 0,
            at: '2026-08-04T09:00:02.000Z',
            sensorTimestampS: 12345.678901234,
            pressureHpa: 1013.2570000000001,
            relativeAltitudeM: 0,
            epoch: 1,
            segmentSeq: 0,
          },
        ],
      }),
    );
    const pointsSection = text.slice(text.indexOf('## points'), text.indexOf('## altitude'));
    const altitudeSection = text.slice(text.indexOf('## altitude'), text.indexOf('## log'));
    expect(pointsSection).toContain(
      '0,2026-08-04T09:00:01.000Z,59.32932312345,18.068581,12.25,5,-1,2.1,0',
    );
    expect(altitudeSection).toContain(
      '0,2026-08-04T09:00:02.000Z,12345.678901234,1013.2570000000001,0,1,0',
    );
  });

  test('a null number becomes an empty field, not the string "null"', () => {
    const text = toRunExport(
      input({
        samples: [
          {
            seq: 0,
            at: 'x',
            sensorTimestampS: null,
            pressureHpa: 1013,
            relativeAltitudeM: null,
            epoch: 1,
            segmentSeq: 0,
          },
        ],
      }),
    );
    // why scoped to the section: the JSON header legitimately serializes `"updateId":null`, so a
    // whole-file assertion would test the header's shape rather than the CSV's null handling.
    const section = text.slice(text.indexOf('## altitude'), text.indexOf('## log'));
    expect(section).toContain('0,x,,1013,,1,0');
    expect(section).not.toContain('null');
  });

  test('escapes a detail payload containing a comma, a quote, a newline and a section marker', () => {
    const detailJson = JSON.stringify({ note: 'a,b "q"\n## points' });
    const text = toRunExport(input({ log: [{ seq: 0, at: 'x', kind: 'cue', detailJson }] }));
    // why sliced to just this section: the log section is followed by `## events`, so slicing to
    // end-of-file would count that real header and prove nothing about forgery.
    const body = text.slice(text.indexOf('## log'), text.indexOf('## events'));
    // JSON.stringify escapes the newline as two characters, so the payload cannot forge a section.
    expect(body.split('\n').filter((l) => l.startsWith('## ')).length).toBe(1);
    // the JSON key's own quotes are real quotes, so CSV escaping doubles them.
    expect(body).toContain('""note""');
  });

  test('quotes a field containing a lone carriage return', () => {
    const text = toRunExport(
      input({ log: [{ seq: 0, at: 'x', kind: 'sensor\rboom', detailJson: null }] }),
    );
    const body = text.slice(text.indexOf('## log'), text.indexOf('## events'));
    expect(body).toContain('"sensor\rboom"');
  });

  test('ends with exactly one newline', () => {
    const text = toRunExport(input());
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  test('ends with a # end trailer whose total equals the summed header counts', () => {
    const text = toRunExport(input());
    const lines = text.split('\n');
    const header = JSON.parse(lines[1]) as { counts: Record<string, number> };
    const expectedTotal = Object.values(header.counts).reduce((a, b) => a + b, 0);
    expect(lines.at(-2)).toBe(`# end ${expectedTotal}`);
    expect(lines.at(-1)).toBe('');
  });
});
