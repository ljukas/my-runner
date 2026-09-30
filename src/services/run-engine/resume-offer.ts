import type { ResumableRun } from './index';

/** Whether a start is safe: not while a launch-time resume is being looked for or decided. */
export type ResumeGate = 'checking' | 'offered' | 'clear';

// Router params cannot carry the session and event log, so the detected run is handed to the
// /resume-run screen through module scope.
let offer: ResumableRun | null = null;
// why checking at first: until the gate has looked, a new run could start beside one it would offer
let gate: ResumeGate = 'checking';
let checkBegun = false;
const listeners = new Set<() => void>();

function setGate(next: ResumeGate): void {
  if (gate === next) return;
  gate = next;
  listeners.forEach((listener) => listener());
}

/** False when a check already ran this launch: a run is offered at most once. */
export function beginResumeCheck(): boolean {
  if (checkBegun) return false;
  checkBegun = true;
  setGate('checking');
  return true;
}

export function settleResumeCheck(): void {
  setGate('clear');
}

export function setResumeOffer(run: ResumableRun): void {
  offer = run;
  setGate('offered');
}

export function peekResumeOffer(): ResumableRun | null {
  return offer;
}

export function clearResumeOffer(): void {
  offer = null;
  setGate('clear');
}

export function subscribeResumeGate(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function getResumeGate(): ResumeGate {
  return gate;
}
