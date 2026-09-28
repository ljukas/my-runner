import { Box, useMaterialColors } from '@expo/ui/jetpack-compose';
import { background, clip, Shapes, size } from '@expo/ui/jetpack-compose/modifiers';
import type { SymbolViewProps } from 'expo-symbols';

import { ComposeSymbol } from '@/components/compose-symbol';

const SHAPES = {
  clover: Shapes.Material.Clover4Leaf,
  pillStar: Shapes.Material.Clover8Leaf,
  squircle: Shapes.Material.Cookie4Sided,
  scallop: Shapes.Material.Cookie6Sided,
};

export type OnboardingHeroShape = keyof typeof SHAPES;

// The spec's 92 dp symbol on a 260 dp hero and 64 dp on 180 dp, kept as one ratio.
const SYMBOL_RATIO = 0.355;

/**
 * A Material 3 Expressive shape with a centred symbol, for a Compose tree: a Compose `Host`
 * inside an RN view that is itself inside Compose lays out but never paints, so the hero cannot
 * be its own island on a pager page.
 */
export function OnboardingHero({
  shape,
  symbol,
  side,
}: {
  shape: OnboardingHeroShape;
  symbol: SymbolViewProps['name'];
  side: number;
}) {
  const colors = useMaterialColors();
  return (
    <Box
      contentAlignment="center"
      modifiers={[size(side, side), clip(SHAPES[shape]), background(colors.primaryContainer)]}
    >
      <ComposeSymbol
        name={symbol}
        size={Math.round(side * SYMBOL_RATIO)}
        tint={colors.onPrimaryContainer}
      />
    </Box>
  );
}
