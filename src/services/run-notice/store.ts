import { NOTICE_TTL_MS, type RunNotice } from '@/domain/run-notice';

interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: never) => void;
}

/** The one notice the Plan tab shows after a free run left no summary; it expires on its own. */
export function createRunNotices(
  ttlMs: number = NOTICE_TTL_MS,
  timers: Timers = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle),
  },
) {
  let notice: RunNotice | null = null;
  let timer: unknown = null;
  const listeners = new Set<() => void>();

  const set = (next: RunNotice | null) => {
    if (timer !== null) timers.clear(timer as never);
    timer = null;
    if (next !== null) timer = timers.set(() => set(null), ttlMs);
    if (notice === next) return;
    notice = next;
    listeners.forEach((listener) => listener());
  };

  return {
    post: (next: RunNotice) => set(next),
    dismiss: () => set(null),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => notice,
  };
}

export const runNotices = createRunNotices();
