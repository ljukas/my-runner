import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { PixelRatio, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { SegmentSymbols } from '@/constants/theme';
import { SEGMENT_KIND_LABEL } from '@/domain/format';
import type { FreeRunLook } from '@/domain/free-run-view';
import type { SegmentKind } from '@/domain/plan';
import { useSegmentColors, useTheme } from '@/hooks/use-theme';

const SYMBOL_POINTS = 22;

// why neutral: a free run with no GPS to classify is not stopped, so it borrows no bucket's colour
const NO_BUCKET_SYMBOLS: Record<'waiting' | 'timerOnly', SymbolViewProps['name']> = {
  waiting: { ios: 'location.magnifyingglass', android: 'location_searching' },
  timerOnly: { ios: 'location.slash', android: 'location_off' },
};

/**
 * Icon and label each centred on their own line, so the header only breathes in
 * width and never translates sideways between segments. The coloured glyph
 * carries the segment cue while the label stays on the theme foreground, so it
 * reads on any palette (main #32). `SymbolView` lays out as a square of its
 * `size`, which is why no reserved frame is needed to hold the height still.
 */
export function RunPhaseHeader({
  kind,
  label,
  paused,
}: {
  kind: SegmentKind | FreeRunLook;
  /** Replaces the kind's own label, as a free run's "Running" does "Run". */
  label?: string;
  paused: boolean;
}) {
  const segmentColors = useSegmentColors();
  const colors = useTheme();
  const noBucket = kind === 'waiting' || kind === 'timerOnly';
  return (
    <View className="items-center gap-1.5">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <SymbolView
          name={noBucket ? NO_BUCKET_SYMBOLS[kind] : SegmentSymbols[kind]}
          size={Math.round(SYMBOL_POINTS * Math.min(PixelRatio.getFontScale(), 1.6))}
          tintColor={noBucket ? colors.textSecondary : segmentColors[kind]}
        />
      </View>
      <Text variant="title2">
        {paused ? 'Paused' : (label ?? (noBucket ? '' : SEGMENT_KIND_LABEL[kind]))}
      </Text>
    </View>
  );
}
