/** How a run ends from its transport: a plan run always confirms; a free run may save or discard. */
export type RunTransportEnd =
  | { mode: 'scripted'; endsAsCompleted: boolean }
  | {
      mode: 'open';
      /** Under a minute: End deletes the run without asking (ADR 0026 §6). */
      discards: boolean;
    };
