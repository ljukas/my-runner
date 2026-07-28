import { Image, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityAddTraits,
  accessibilityHint,
  accessibilityLabel,
  contentShape,
  font,
  frame,
  onLongPressGesture,
  shapes,
  symbolEffect,
} from '@expo/ui/swift-ui/modifiers';

import { Island } from '@/components/island';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/services/haptics';

const GLYPH_SIZE = 32;
const TAP_TARGET = 44;
// Seconds: SwiftUI's `minimumDuration` is a Double in seconds, not milliseconds.
const UNLOCK_HOLD_SECONDS = 1.2;

/**
 * Tap to lock, press and hold to unlock. The two states are separate subtrees
 * because a SwiftUI `Button` outranks an attached long press in the gesture
 * arena, so the locked state drops the Button and carries the gesture itself.
 */
export function RunLock({
  locked,
  onLockedChange,
}: {
  locked: boolean;
  onLockedChange: (locked: boolean) => void;
}) {
  const colors = useTheme();

  if (!locked) {
    return (
      <Island matchContents>
        <VStack spacing={4} alignment="center">
          <Island.IconButton
            systemName="lock.open.display"
            size={GLYPH_SIZE}
            color={colors.textSecondary}
            label="Lock screen"
            onPress={() => onLockedChange(true)}
          />

          <Island.Text tone="secondary" modifiers={[font({ textStyle: 'caption' })]}>
            Tap to lock
          </Island.Text>
        </VStack>
      </Island>
    );
  }

  const unlock = () => {
    onLockedChange(false);
    haptics.confirm();
  };

  return (
    <Island matchContents>
      {/* The caption only widens the centred stack, so the glyph's centre — the
          target the finger just tapped — does not move when it appears. */}
      <VStack spacing={4} alignment="center">
        <Image
          systemName="lock.display"
          size={GLYPH_SIZE}
          color={colors.text}
          modifiers={[
            frame({ width: TAP_TARGET, height: TAP_TARGET }),
            contentShape(shapes.rectangle()),
            onLongPressGesture(unlock, UNLOCK_HOLD_SECONDS),
            symbolEffect({ effect: 'pulse' }, { options: { repeat: { count: 2 } } }),
            accessibilityAddTraits(['isButton']),
            accessibilityLabel('Unlock screen'),
            accessibilityHint('Press and hold to unlock'),
          ]}
        />
        <Island.Text tone="secondary" modifiers={[font({ textStyle: 'caption' })]}>
          Hold to unlock
        </Island.Text>
      </VStack>
    </Island>
  );
}
