import { useEffect, useRef } from 'react';
import { useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const TRACK_HEIGHT = 6;
// Matches the run screen VStack's horizontal padding so the bar spans the same
// width the SwiftUI Gauge did.
const H_PADDING = 24;

/**
 * The run screen's segment progress bar. Reanimated so the fill sweeps smoothly
 * across each 1 s engine tick (`withTiming`), and snaps straight to the new
 * segment's start — no backward sweep — when `segmentIndex` changes, without a
 * remount. A fixed-size RN view hosted in the SwiftUI tree via `RNHostView`
 * (ADR 0005); the fixed height is what keeps segment changes from shifting the
 * surrounding layout.
 */
export function RunProgressBar({
  progress,
  color,
  segmentIndex,
}: {
  progress: number;
  color: string;
  segmentIndex: number;
}) {
  const width = useWindowDimensions().width - H_PADDING * 2;
  const value = useSharedValue(progress);
  const prevSegment = useRef(segmentIndex);

  useEffect(() => {
    if (prevSegment.current !== segmentIndex) {
      // New segment: jump to its starting fill instantly, no backward sweep.
      prevSegment.current = segmentIndex;
      cancelAnimation(value);
      value.value = progress;
    } else {
      value.value = withTiming(progress, { duration: 1000, easing: Easing.linear });
    }
  }, [progress, segmentIndex, value]);

  const fillStyle = useAnimatedStyle(() => ({ width: value.value * width }));

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
