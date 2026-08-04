import type { AltitudeReading } from '@/services/elevation';

/** why capped: if flushes are failing and retrying, instrumentation must not grow without bound. */
export const MAX_LOG_BUFFER = 4000;
/** why a separate batch cap: SQLite caps a statement at 32,766 bind parameters (engine.ts's MAX_FLUSH_POINTS). */
export const MAX_LOG_BATCH = 500;

// why not expo-crypto: it transitively requires react-native, which breaks under `bun test` the
// instant this module is imported (Bun's transpiler cannot parse RN's Flow syntax) — and spec
// §4.2 only needs the token distinct across process launches, not RFC 4122-compliant.
/** Distinguishes a process boundary in the export, which `epoch` alone cannot (spec §4.2). */
export const PROCESS_TOKEN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export type RunLogKind =
  | 'tick'
  | 'fix_batch'
  | 'fix_rejected'
  | 'lifecycle'
  | 'battery'
  | 'cue'
  | 'sensor'
  | 'permission'
  | 'pedometer'
  | 'samples_dropped';

export interface PendingSample {
  seq: number;
  at: number;
  sensorTimestampS: number | null;
  pressureHpa: number;
  relativeAltitudeM: number | null;
  epoch: number;
  segmentSeq: number;
}

export interface PendingEntry {
  seq: number;
  at: number;
  kind: RunLogKind;
  detailJson: string | null;
}

/**
 * The run's instrumentation buffers. Owns `seq` so any drop — a validation failure or a cap
 * eviction — always leaves a gap in the sequence, never a clean stretch indistinguishable from a
 * suspension (spec §6.2).
 */
export class RunLog {
  private samples: PendingSample[] = [];
  private entries: PendingEntry[] = [];
  private nextSampleSeq = 0;
  private nextEntrySeq = 0;
  private dropped = 0;

  get pendingSamples(): readonly PendingSample[] {
    return this.samples;
  }

  get pendingEntries(): readonly PendingEntry[] {
    return this.entries;
  }

  /** why exposed: the export header reports total drops, and a cap drop cannot `note()` from inside `push` without recursing. */
  get droppedCount(): number {
    return this.dropped;
  }

  restoreFrom({ sampleSeq, entrySeq }: { sampleSeq: number; entrySeq: number }): void {
    this.nextSampleSeq = sampleSeq;
    this.nextEntrySeq = entrySeq;
  }

  note(kind: RunLogKind, detail: unknown): void {
    let detailJson: string | null = null;
    if (detail !== null && detail !== undefined) {
      try {
        detailJson = JSON.stringify(detail);
      } catch {
        detailJson = null;
      }
    }
    this.push(this.entries, { seq: this.nextEntrySeq++, at: Date.now(), kind, detailJson });
  }

  sample(reading: AltitudeReading, segmentSeq: number, epochBase: number): void {
    if (!Number.isFinite(reading.pressureHpa)) {
      // why: consume the seq here too, so a validation drop leaves the same seq-gap evidence a
      // cap eviction does — any gap uniformly means "a reading was dropped here" (see class docstring).
      this.nextSampleSeq += 1;
      this.dropped += 1;
      this.note('samples_dropped', { reason: 'nonfinite', total: this.dropped });
      return;
    }
    this.push(this.samples, {
      seq: this.nextSampleSeq++,
      at: reading.at,
      sensorTimestampS: reading.sensorTimestampS,
      pressureHpa: reading.pressureHpa,
      relativeAltitudeM: reading.relativeAltitudeM,
      epoch: epochBase + reading.epoch,
      segmentSeq,
    });
  }

  takeSamples(limit = MAX_LOG_BATCH): PendingSample[] {
    return this.samples.splice(0, limit);
  }

  takeEntries(limit = MAX_LOG_BATCH): PendingEntry[] {
    return this.entries.splice(0, limit);
  }

  /** Puts a rejected flush's samples back ahead of anything buffered meanwhile, `seq` untouched. */
  restoreSamples(items: PendingSample[]): void {
    this.samples = this.restore(this.samples, items);
  }

  /** Puts a rejected flush's entries back ahead of anything buffered meanwhile, `seq` untouched. */
  restoreEntries(items: PendingEntry[]): void {
    this.entries = this.restore(this.entries, items);
  }

  reset(): void {
    this.samples = [];
    this.entries = [];
    this.nextSampleSeq = 0;
    this.nextEntrySeq = 0;
    this.dropped = 0;
  }

  private push<T>(target: T[], item: T): void {
    target.push(item);
    if (target.length > MAX_LOG_BUFFER) {
      target.splice(0, target.length - MAX_LOG_BUFFER);
      this.dropped += 1;
    }
  }

  // why front: a rejected flush's rows must be retried ahead of anything buffered while it was in
  // flight, per RunStore.flush's re-send contract (run-store/port.ts); the cap still applies, so
  // restoring past it drops from the oldest end exactly like `push` does.
  private restore<T>(target: T[], items: T[]): T[] {
    const merged = items.concat(target);
    if (merged.length > MAX_LOG_BUFFER) {
      const excess = merged.length - MAX_LOG_BUFFER;
      this.dropped += excess;
      return merged.slice(excess);
    }
    return merged;
  }
}
