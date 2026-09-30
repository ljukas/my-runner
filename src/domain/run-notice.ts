/** Why a free run left no summary (ADR 0026 §6): the one thing the Plan tab says after it. */
export type RunNotice = 'discarded' | 'tooShort';

export const RUN_NOTICE_TEXT: Record<RunNotice, string> = {
  discarded: 'Run discarded',
  tooShort: 'Too short to save — under a minute',
};

/** How long the notice stays: a few seconds, with margin for a test's polling. */
export const NOTICE_TTL_MS = 6000;
