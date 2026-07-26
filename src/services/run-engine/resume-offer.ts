import type { ResumableRun } from './index';

// Router params cannot carry the session and event log, so the detected run is handed to the
// /resume-run screen through module scope.
let offer: ResumableRun | null = null;

export function setResumeOffer(run: ResumableRun): void {
  offer = run;
}

export function peekResumeOffer(): ResumableRun | null {
  return offer;
}

export function clearResumeOffer(): void {
  offer = null;
}
