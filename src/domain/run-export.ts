/** Pure run-export serialization — no React/Expo/DB imports (ADR 0003). */

export const RUN_EXPORT_MAGIC = 'runbro-export/1';
export const RUN_EXPORT_SCHEMA = 1;

export interface RunExportDevice {
  deviceName: string;
  osVersion: string;
  appVersion: string;
  updateId: string | null;
  barometerAvailable: boolean;
  motionPermission: string | null;
  timezoneOffsetMin: number;
}

export interface ExportRun {
  id: string;
  sessionKey: string;
  status: string;
  startedAt: string;
  endedAt: string;
  activeDurationS: number;
  distanceM: number | null;
}

export interface ExportSegment {
  seq: number;
  kind: string;
  plannedDurationS: number;
  actualDurationS: number;
  distanceM: number | null;
  wasSkipped: boolean;
}

export interface ExportPoint {
  seq: number;
  at: string;
  lat: number;
  lng: number;
  altitudeM: number | null;
  accuracyM: number | null;
  altitudeAccuracyM: number | null;
  speedMps: number | null;
  segmentSeq: number;
}

export interface ExportAltitudeSample {
  seq: number;
  at: string;
  sensorTimestampS: number | null;
  pressureHpa: number;
  relativeAltitudeM: number | null;
  epoch: number;
  segmentSeq: number;
}

export interface ExportLogEntry {
  seq: number;
  at: string;
  kind: string;
  detailJson: string | null;
}

export interface ExportEvent {
  at: number;
  type: string;
}

export interface RunExportInput {
  exportedAt: string;
  device: RunExportDevice;
  run: ExportRun;
  segments: readonly ExportSegment[];
  points: readonly ExportPoint[];
  samples: readonly ExportAltitudeSample[];
  log: readonly ExportLogEntry[];
  events: readonly ExportEvent[];
}

// why String, never toFixed: shortest round-trip is lossless except -0 → "0"; 1 dp on pressure
// costs 0.83 m of altitude — the barometer's edge over GPS (spec §7.1).
function num(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

function csv(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function section(name: string, columns: string, rows: readonly string[]): string[] {
  return [`## ${name}`, columns, ...rows, ''];
}

/**
 * One run as a `#` magic line, a single-line JSON header, then CSV sections, then a `# end <total>`
 * trailer (spec §7.1) — a truncated write stops mid-file and never reaches it, so its presence is
 * what lets a reader tell a complete export from one cut short. Ends with exactly one newline.
 */
export function toRunExport(input: RunExportInput): string {
  const { run, segments, points, samples, log, events } = input;

  const counts = {
    segments: segments.length,
    points: points.length,
    altitude: samples.length,
    log: log.length,
    events: events.length,
  };

  const header = {
    schema: RUN_EXPORT_SCHEMA,
    exportedAt: input.exportedAt,
    run,
    device: input.device,
    counts,
  };

  const lines = [
    `# ${RUN_EXPORT_MAGIC}`,
    JSON.stringify(header),
    '',
    ...section(
      'segments',
      'seq,kind,plannedDurationS,actualDurationS,distanceM,wasSkipped',
      segments.map((s) =>
        [
          s.seq,
          csv(s.kind),
          s.plannedDurationS,
          s.actualDurationS,
          num(s.distanceM),
          s.wasSkipped ? 1 : 0,
        ].join(','),
      ),
    ),
    ...section(
      'points',
      'seq,at,lat,lng,altitudeM,accuracyM,altitudeAccuracyM,speedMps,segmentSeq',
      points.map((p) =>
        [
          p.seq,
          csv(p.at),
          num(p.lat),
          num(p.lng),
          num(p.altitudeM),
          num(p.accuracyM),
          num(p.altitudeAccuracyM),
          num(p.speedMps),
          p.segmentSeq,
        ].join(','),
      ),
    ),
    ...section(
      'altitude',
      'seq,at,sensorTimestampS,pressureHpa,relativeAltitudeM,epoch,segmentSeq',
      samples.map((s) =>
        [
          s.seq,
          csv(s.at),
          num(s.sensorTimestampS),
          num(s.pressureHpa),
          num(s.relativeAltitudeM),
          s.epoch,
          s.segmentSeq,
        ].join(','),
      ),
    ),
    ...section(
      'log',
      'seq,at,kind,detailJson',
      log.map((e) => [e.seq, csv(e.at), csv(e.kind), csv(e.detailJson ?? '')].join(',')),
    ),
    ...section(
      'events',
      'at,type',
      events.map((e) => [e.at, csv(e.type)].join(',')),
    ),
    `# end ${Object.values(counts).reduce((a, b) => a + b, 0)}`,
  ];

  return `${lines.join('\n').trimEnd()}\n`;
}
