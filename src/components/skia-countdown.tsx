import { useState } from 'react';
import { useAnimatedReaction, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { SkiaClockFace } from '@/components/skia-clock';

/**
 * The plan run's countdown in whole seconds of the shared `remaining` clock, which also drives the
 * progress bar; it hops to JS only when the second changes.
 */
export function SkiaCountdown({
  remaining,
  color,
}: {
  remaining: SharedValue<number>;
  color: string;
}) {
  // Ceil so a fresh segment shows its full length and the clock reads 0:00 only at the exact
  // boundary. why 0: the reaction's first run seeds it — never read a shared value during render.
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
