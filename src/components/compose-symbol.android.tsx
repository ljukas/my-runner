import { Box, RNHostView } from '@expo/ui/jetpack-compose';
import { size as sizeModifier } from '@expo/ui/jetpack-compose/modifiers';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ColorValue } from 'react-native';
import { View } from 'react-native';

/** A decorative `expo-symbols` glyph for a Compose tree, where `Icon` would need drawable assets. */
export function ComposeSymbol({
  name,
  size,
  tint,
}: {
  name: SymbolViewProps['name'];
  size: number;
  tint: ColorValue;
}) {
  // why the Box: an RNHostView takes its parent's size, not its own.
  return (
    <Box modifiers={[sizeModifier(size, size)]}>
      <RNHostView>
        <View
          className="flex-1 items-center justify-center"
          importantForAccessibility="no-hide-descendants"
        >
          <SymbolView name={name} size={size} tintColor={tint} />
        </View>
      </RNHostView>
    </Box>
  );
}
