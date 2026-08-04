import type { AltitudeReading } from '@/services/elevation';

/** why capped: if flushes are failing and retrying, instrumentation must not grow without bound. */
export const MAX_LOG_BUFFER = 4000;
/** why a separate batch cap: SQLite caps a statement at 32,766 bind parameters (engine.ts's MAX_FLUSH_POINTS). */
export const MAX_LOG_BATCH = 500;
const CAP_DROP_NOTE_EVERY = 100;

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
  // why counted apart from `dropped`: `push`'s note cadence keys off the *first* cap eviction, and a
  // validation drop earlier in the run would otherwise have consumed that first slot silently.
  private capDrops = 0;
  // why a flag: the drop note is itself an entry, so noting an eviction of the *entry* buffer
  // re-enters `push`, which evicts again, which notes again. Suppressing the inner note bounds the
  // recursion at one level; `dropped` still counts it, and the next emitted note reports the total.
  private notingDrop = false;

  get pendingSamples(): readonly PendingSample[] {
    return this.samples;
  }

  get pendingEntries(): readonly PendingEntry[] {
    return this.entries;
  }

  // why still exposed with no production caller: the tests assert drop accounting through it. The
  // export gets the total from the `samples_dropped` payloads instead (domain/run-export.ts).
  get droppedCount(): number {
    return this.dropped;
  }

  /** The next ids to mint — `restoreFrom`'s inverse, which the run snapshot stores as its watermark. */
  get watermarks(): { sampleSeq: number; entrySeq: number } {
    return { sampleSeq: this.nextSampleSeq, entrySeq: this.nextEntrySeq };
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
      this.noteDropped('nonfinite');
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
    const { kept, evicted } = this.restore(this.samples, items);
    this.samples = kept;
    if (evicted > 0) this.noteDropped('cap');
  }

  /** Puts a rejected flush's entries back ahead of anything buffered meanwhile, `seq` untouched. */
  restoreEntries(items: PendingEntry[]): void {
    const { kept, evicted } = this.restore(this.entries, items);
    // why the note only after the assignment: it appends to `this.entries`, and appending to the
    // array `restore` is about to replace would throw the note away with it.
    this.entries = kept;
    if (evicted > 0) this.noteDropped('cap');
  }

  reset(): void {
    this.samples = [];
    this.entries = [];
    this.nextSampleSeq = 0;
    this.nextEntrySeq = 0;
    this.dropped = 0;
    this.capDrops = 0;
    this.notingDrop = false;
  }

  // why noted at all: a cap eviction is the only way a real device loses instrumentation, and
  // without a row beside it the loss is a bare `seq` gap — indistinguishable from the suspension gap
  // this slice exists to measure (spec §6.2 item 3).
  private noteDropped(reason: string): void {
    if (this.notingDrop) return;
    this.notingDrop = true;
    try {
      this.note('samples_dropped', { reason, total: this.dropped });
    } finally {
      this.notingDrop = false;
    }
  }

  private push<T>(target: T[], item: T): void {
    target.push(item);
    if (target.length <= MAX_LOG_BUFFER) return;
    const evicted = target.length - MAX_LOG_BUFFER;
    target.splice(0, evicted);
    this.dropped += evicted;
    this.capDrops += evicted;
    // why not one note per eviction: a saturated buffer evicts once per arriving row, so a note
    // each time would spend the entry buffer on drop notices and evict the tick/fix_batch trace it
    // exists to carry. The first says "this run lost rows"; the periodic ones keep the total current.
    if (this.capDrops === 1 || this.capDrops % CAP_DROP_NOTE_EVERY === 0) this.noteDropped('cap');
  }

  // why front: a rejected flush's rows must be retried ahead of anything buffered while it was in
  // flight, per RunStore.flush's re-send contract (run-store/port.ts); the cap still applies, so
  // restoring past it drops from the oldest end exactly like `push` does.
  private restore<T>(target: T[], items: T[]): { kept: T[]; evicted: number } {
    const merged = items.concat(target);
    const evicted = Math.max(0, merged.length - MAX_LOG_BUFFER);
    if (evicted === 0) return { kept: merged, evicted };
    this.dropped += evicted;
    this.capDrops += evicted;
    return { kept: merged.slice(evicted), evicted };
  }
}
