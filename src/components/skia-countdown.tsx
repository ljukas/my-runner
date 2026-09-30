import { useState } from 'react';
import { useAnimatedReaction, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { SkiaClockFace } from '@/components/skia-clock';

/**
 * The plan run's countdown. The visible clock is whole `M:SS`; the sub-second precision lives in the
 * shared `remaining` clock that also drives the progress bar and the exact segment boundary. We
 * derive whole seconds from it on the UI thread and hop to JS only when the second changes (~1/s)
 * to feed the digits — so the clock reads its full length at the start and `0:00` exactly at the
 * boundary, never advancing a second early.
 */
export function SkiaCountdown({
  remaining,
  color,
}: {
  remaining: SharedValue<number>;
  color: string;
}) {
  // Ceil so a fresh segment shows its full length and the clock only reads 0:00
  // at the exact boundary. Seeded by the reaction's first run (never read the
  // shared value during render).
  const [secondsLeft, setSecondsLeft] = useState(0);

  useAnimatedReaction(
    () => Math.max(0, Math.ceil(remaining.value)),
    (secs, prev) => {
      if (secs !== prev) scheduleOnRN(setSecondsLeft, secs);
    },
  );
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <SkiaClockFace
      minutes={minutes}
      seconds={seconds}
      label={`${minutes}:${String(seconds).padStart(2, '0')}`}
      color={color}
    />
  );
}
