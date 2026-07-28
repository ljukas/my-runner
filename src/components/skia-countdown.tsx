import { Canvas, matchFont } from '@shopify/react-native-skia';
import { SkiaTimeFlow } from 'number-flow-react-native/skia';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useAnimatedReaction, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

const FONT_SIZE = 80;
// Tall/wide enough for the vertical digit roll plus SkiaTimeFlow's top/bottom
// gradient fade; the clock is centred within the available width.
const CANVAS_HEIGHT = 132;
const BASELINE_Y = 96;

/**
 * The run screen's countdown, rendered with number-flow's Skia backend so the
 * rolling digits fade at the top/bottom edges (`mask`, on by default).
 *
 * The visible clock is whole `M:SS`; the sub-second precision lives in the
 * shared `remaining` clock that also drives the progress bar and the exact
 * segment boundary. We derive whole seconds from it on the UI thread and hop to
 * JS only when the second changes (~1/s) to feed `SkiaTimeFlow`'s numeric props
 * — so the clock reads its full length at the start and `0:00` exactly at the
 * boundary, never advancing a second early.
 */
export function SkiaCountdown({
  remaining,
  color,
}: {
  remaining: SharedValue<number>;
  color: string;
}) {
  // Skia paints into pixel coordinates, so the canvas reports the width RN gave
  // it rather than the screen's padding being restated here.
  const [width, setWidth] = useState(0);
  const font = useMemo(() => matchFont({ fontSize: FONT_SIZE, fontWeight: 'bold' }), []);
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
    // Skia draws to a canvas VoiceOver can't read, so label the wrapper.
    <View
      className="w-full"
      style={{ height: CANVAS_HEIGHT }}
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${minutes}:${String(seconds).padStart(2, '0')}`}
    >
      <Canvas style={{ flex: 1 }}>
        <SkiaTimeFlow
          minutes={minutes}
          seconds={seconds}
          font={font}
          color={color}
          x={0}
          y={BASELINE_Y}
          width={width}
          textAlign="center"
          tabularNums
        />
      </Canvas>
    </View>
  );
}
