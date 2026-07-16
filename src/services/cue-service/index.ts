import { effectiveCue } from '@/domain/cues';
import { settingsStore } from '@/services/settings-store';

import { cueService as adapter } from './adapter';
import type { CueService } from './port';

export type { CueService } from './port';

/**
 * Cue gating lives here, at the platform-agnostic composition seam — not in the
 * adapter. Filtering interval vs milestone cues is user policy, identical on
 * every platform, so each platform adapter stays a dumb producer that just
 * plays the resolved cue. Metro/TypeScript resolve `./adapter` to the platform
 * fork (`adapter.ios.ts` today) per ADR 0003; Android's adapter plugs in with
 * no gating code of its own.
 */
export const cueService: CueService = {
  prepare: () => adapter.prepare(),
  announce: (cue) => {
    const s = settingsStore.getSnapshot();
    const effective = effectiveCue(cue, {
      intervalCues: s.intervalCuesEnabled,
      milestoneCues: s.milestoneCuesEnabled,
    });
    if (effective) adapter.announce(effective);
  },
  release: () => adapter.release(),
};
