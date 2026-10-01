import { NOTICE_TTL_MS, type RunNotice } from '@/domain/run-notice';

interface Timers<H> {
  set: (fn: () => void, ms: number) => H;
  clear: (handle: H) => void;
}

/** The one notice shown after a free run left no summary; it expires `ttlMs` after it is first shown. */
export function createRunNotices<H>(ttlMs: number, timers: Timers<H>) {
  let notice: RunNotice | null = null;
  let timer: H | null = null;
  const listeners = new Set<() => void>();

  const set = (next: RunNotice | null) => {
    if (timer !== null) timers.clear(timer);
    timer = null;
    if (notice === next) return;
    notice = next;
    listeners.forEach((listener) => listener());
  };

  return {
    post: (next: RunNotice) => set(next),
    dismiss: () => set(null),
    // why not from the post: Plan sits under the run modal when it is posted, so the time counts from
    // the moment the runner can actually read it
    shown: () => {
      if (notice !== null && timer === null) timer = timers.set(() => set(null), ttlMs);
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => notice,
  };
}

export const runNotices = createRunNotices(NOTICE_TTL_MS, {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle),
});
