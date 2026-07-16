import { useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

const TRACK_HEIGHT = 6;
// Matches the run screen VStack's horizontal padding so the bar spans the same
// width the SwiftUI Gauge did.
const H_PADDING = 24;

/**
 * The run screen's segment progress bar. Its fill is derived every frame on the
 * UI thread from the shared `remaining` value, so it sweeps smoothly and reaches
 * exactly 1.0 at the segment boundary; the next segment re-seeds `remaining`,
 * snapping the fill back to 0 with no backward sweep. A fixed-height RN view
 * hosted in the SwiftUI tree via `RNHostView` (ADR 0005); the fixed height keeps
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
  const width = useWindowDimensions().width - H_PADDING * 2;
  const fillStyle = useAnimatedStyle(() => {
    const progress = totalSeconds > 0 ? 1 - remaining.value / totalSeconds : 0;
    return { width: Math.min(1, Math.max(0, progress)) * width };
  });

  return (
    <View
      style={{
        width,
        height: TRACK_HEIGHT,
        borderRadius: TRACK_HEIGHT / 2,
        backgroundColor: 'rgba(120,120,128,0.2)',
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={[
          { height: '100%', borderRadius: TRACK_HEIGHT / 2, backgroundColor: color },
          fillStyle,
        ]}
      />
    </View>
  );
}
