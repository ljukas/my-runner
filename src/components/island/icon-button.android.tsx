import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { type ColorValue, Pressable } from 'react-native';

// Material's minimum touch target.
const MIN_TARGET = 48;

/** Icon-only controls stay RN (ADR 0025 §2). `label` is the control's only text: the TalkBack label and the test anchor. */
export function IslandIconButton({
  systemName,
  size,
  color,
  label,
  disabled = false,
  onPress,
}: {
  systemName: SymbolViewProps['name'];
  size: number;
  color: ColorValue;
  label: string;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const target = Math.max(size, MIN_TARGET);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color, borderless: true, radius: target / 2 }}
      className="items-center justify-center"
      style={{ width: target, height: target, opacity: disabled ? 0.38 : 1 }}
    >
      <SymbolView name={systemName} size={size} tintColor={color} />
    </Pressable>
  );
}
