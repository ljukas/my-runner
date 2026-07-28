import { useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

/**
 * The run screen's segment progress bar. Its fill is derived every frame on the
 * UI thread from the shared `remaining` value, so it sweeps smoothly and reaches
 * exactly 1.0 at the segment boundary; the next segment re-seeds `remaining`,
 * snapping the fill back to 0 with no backward sweep. The fixed height keeps
 * segment changes from shifting the surrounding layout.
 */
export function RunProgressBar({
  remaining,
  totalSeconds,
  color,
}: {
  remaining: SharedValue<number>;
  totalSeconds: number;
  color: string;
}) {
  // The fill animates `width`, which has to be a number, so the track reports
  // the width RN gave it rather than the screen's padding being restated here.
  const [width, setWidth] = useState(0);
  const fillStyle = useAnimatedStyle(() => {
    const progress = totalSeconds > 0 ? 1 - remaining.value / totalSeconds : 0;
    return { width: Math.min(1, Math.max(0, progress)) * width };
  });

  return (
    <View
      className="h-1.5 w-full overflow-hidden rounded-full"
      style={{ backgroundColor: 'rgba(120,120,128,0.2)' }}
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
    >
      <Animated.View
        className="h-full rounded-full"
        style={[{ backgroundColor: color }, fillStyle]}
      />
    </View>
  );
}
