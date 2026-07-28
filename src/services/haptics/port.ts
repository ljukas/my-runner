/**
 * UI feedback haptics (ADR 0003) — not ADR 0009's cue accents: these confirm a
 * direct manipulation, so they carry no coaching meaning, are ungated by the
 * cue settings, and never throw.
 */
export interface Haptics {
  confirm(): void;
}
