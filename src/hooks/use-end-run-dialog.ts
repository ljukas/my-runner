import { useState } from 'react';

import type { RunTransportEnd } from '@/components/run-transport-end';
import { runEngine } from '@/services/run-engine';
import type { FinalizeIntent } from '@/services/run-engine/mode';

/** The End button's behaviour, shared by both transport forks so only their rendering differs. */
export function useEndRunDialog(end: RunTransportEnd) {
  const [open, setOpen] = useState(false);

  const requestEnd = () => {
    // why the save path: the mode turns a run under a minute into a "too short" discard itself, so
    // only the dialog's own Discard reads as "discarded"
    if (end.mode === 'open' && end.discards) runEngine.endEarly('save');
    else setOpen(true);
  };

  const finish = (intent: FinalizeIntent = 'save') => {
    setOpen(false);
    runEngine.endEarly(intent);
  };

  return { open, setOpen, requestEnd, finish };
}
