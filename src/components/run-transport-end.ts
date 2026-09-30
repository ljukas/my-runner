/** How a run ends from its transport: a plan run always confirms; a free run may save or discard. */
export type RunTransportEnd =
  | { mode: 'scripted'; endsAsCompleted: boolean }
  /** `discards`: under a minute, so End deletes the run without asking (ADR 0026 §6). */
  | { mode: 'open'; discards: boolean };
