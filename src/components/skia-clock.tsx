import { Canvas, matchFont } from '@shopify/react-native-skia';
import { SkiaTimeFlow } from 'number-flow-react-native/skia';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { SKIA_FONT_FAMILY } from '@/constants/skia-font';

const FONT_SIZE = 80;
// Tall/wide enough for the vertical digit roll plus SkiaTimeFlow's top/bottom
// gradient fade; the clock is centred within the available width.
const CANVAS_HEIGHT = 132;
const BASELINE_Y = 96;

/**
 * The run screen's clock digits, rendered with number-flow's Skia backend so the rolling digits fade
 * at the top/bottom edges (`mask`, on by default). `label` is what VoiceOver/TalkBack read, since
 * the canvas itself is opaque to them.
 */
export function SkiaClockFace({
  hours,
  minutes,
  seconds,
  label,
  color,
}: {
  /** Omit to show `M:SS`. */
  hours?: number;
  minutes: number;
  seconds: number;
  label: string;
  color: string;
}) {
  // Skia paints into pixel coordinates, so the canvas reports the width RN gave
  // it rather than the screen's padding being restated here.
  const [width, setWidth] = useState(0);
  const font = useMemo(
    () => matchFont({ fontFamily: SKIA_FONT_FAMILY, fontSize: FONT_SIZE, fontWeight: 'bold' }),
    [],
  );

  return (
    <View
      className="w-full"
      style={{ height: CANVAS_HEIGHT }}
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      <Canvas style={{ flex: 1 }}>
        <SkiaTimeFlow
          {...(hours === undefined ? {} : { hours, padHours: false })}
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
