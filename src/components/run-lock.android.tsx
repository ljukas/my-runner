import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/services/haptics';

const GLYPH_SIZE = 32;
const TAP_TARGET = 48;
const UNLOCK_HOLD_MS = 1200;

/** Tap to lock, press and hold to unlock — RN's own long press, with a Material ripple. */
export function RunLock({
  locked,
  onLockedChange,
}: {
  locked: boolean;
  onLockedChange: (locked: boolean) => void;
}) {
  const colors = useTheme();
  // Both handlers stay mounted in both states: RN only cancels the press that follows a long press
  // while `onLongPress` is still set on release, and unlocking swaps the props mid-gesture — a
  // state-dependent `onLongPress` therefore re-locks on the finger lift.
  const lock = () => {
    if (!locked) onLockedChange(true);
  };
  const unlock = () => {
    if (!locked) return;
    onLockedChange(false);
    haptics.confirm();
  };

  return (
    <View className="items-center gap-1">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={locked ? 'Unlock screen' : 'Lock screen'}
        accessibilityHint={locked ? 'Press and hold to unlock' : undefined}
        onPress={lock}
        onLongPress={unlock}
        delayLongPress={UNLOCK_HOLD_MS}
        android_ripple={{ color: colors.textSecondary, borderless: true, radius: TAP_TARGET / 2 }}
        className="items-center justify-center"
        style={{ width: TAP_TARGET, height: TAP_TARGET }}
      >
        <SymbolView
          name={{ android: locked ? 'lock' : 'lock_open' }}
          size={GLYPH_SIZE}
          tintColor={locked ? colors.text : colors.textSecondary}
        />
      </Pressable>
      <Text variant="caption" tone="secondary">
        {locked ? 'Hold to unlock' : 'Tap to lock'}
      </Text>
    </View>
  );
}
