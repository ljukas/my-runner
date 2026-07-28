import { SymbolView } from 'expo-symbols';
import { PixelRatio, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { SegmentSymbols } from '@/constants/theme';
import { SEGMENT_KIND_LABEL } from '@/domain/format';
import type { SegmentKind } from '@/domain/plan';
import { useSegmentColors } from '@/hooks/use-theme';

const SYMBOL_POINTS = 22;

/**
 * Icon and label each centred on their own line, so the header only breathes in
 * width and never translates sideways between segments. The coloured glyph
 * carries the segment cue while the label stays on the theme foreground, so it
 * reads on any palette (main #32). `SymbolView` lays out as a square of its
 * `size`, which is why no reserved frame is needed to hold the height still.
 */
export function RunPhaseHeader({ kind, paused }: { kind: SegmentKind; paused: boolean }) {
  const segmentColors = useSegmentColors();
  return (
    <View className="items-center gap-1.5">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <SymbolView
          name={SegmentSymbols[kind]}
          size={Math.round(SYMBOL_POINTS * Math.min(PixelRatio.getFontScale(), 1.6))}
          tintColor={segmentColors[kind]}
        />
      </View>
      <Text variant="title2">{paused ? 'Paused' : SEGMENT_KIND_LABEL[kind]}</Text>
    </View>
  );
}
