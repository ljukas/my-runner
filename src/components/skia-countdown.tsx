import { Canvas, matchFont } from '@shopify/react-native-skia';
import { SkiaTimeFlow } from 'number-flow-react-native/skia';
import { useMemo } from 'react';
import { View } from 'react-native';

const FONT_SIZE = 80;
// Canvas must be tall/wide enough for the vertical digit roll plus the top/bottom
// gradient fade (SkiaTimeFlow's `mask`); the clock is centred inside this width.
const CANVAS_WIDTH = 300;
const CANVAS_HEIGHT = 132;
const BASELINE_Y = 96;

/**
 * The run screen's countdown, rendered with number-flow's Skia backend so the
 * rolling digits fade at the top/bottom edges (`mask`, on by default). It is a
 * React Native view (Skia `Canvas`), hosted inside the screen's SwiftUI tree via
 * `RNHostView` (ADR 0005). Feed it whole minutes/seconds; it animates the roll.
 */
export function SkiaCountdown({
  minutes,
  seconds,
  color,
}: {
  minutes: number;
  seconds: number;
  color: string;
}) {
  const font = useMemo(() => matchFont({ fontSize: FONT_SIZE, fontWeight: 'bold' }), []);

  return (
    // Skia draws to a canvas VoiceOver can't read, so label the wrapper (number-flow's
    // guidance) — the View-based renderer exposed this automatically.
    <View
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
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
          width={CANVAS_WIDTH}
          textAlign="center"
          tabularNums
        />
      </Canvas>
    </View>
  );
}
