import { Button, OutlinedButton, Text } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, height, testID as testIDModifier } from '@expo/ui/jetpack-compose/modifiers';

import { useTheme } from '@/hooks/use-theme';

import { IslandHost } from './host';

type IslandButtonVariant = 'primary' | 'secondary' | 'destructive';

const CTA_HEIGHT = 52;

/** Standalone by default; `inline` renders bare for an existing Compose tree. */
export function IslandButton({
  variant = 'primary',
  label,
  onPress,
  disabled = false,
  fill = false,
  inline = false,
  testID,
}: {
  variant?: IslandButtonVariant;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  fill?: boolean;
  inline?: boolean;
  testID?: string;
}) {
  const colors = useTheme();
  const modifiers = [
    ...(fill ? [fillMaxWidth(), height(CTA_HEIGHT)] : []),
    ...(testID ? [testIDModifier(testID)] : []),
  ];
  const content = <Text style={{ typography: 'labelLarge' }}>{label}</Text>;

  const button =
    variant === 'secondary' ? (
      <OutlinedButton onClick={onPress} enabled={!disabled} modifiers={modifiers}>
        {content}
      </OutlinedButton>
    ) : (
      <Button
        onClick={onPress}
        enabled={!disabled}
        modifiers={modifiers}
        colors={
          variant === 'destructive'
            ? { containerColor: colors.destructive, contentColor: colors.destructiveForeground }
            : undefined
        }
      >
        {content}
      </Button>
    );

  if (inline) return button;

  // why: a fixed height is known to RN at first layout; a `fitToContents` sheet measured before
  // Compose reported the height came up one button short.
  return fill ? (
    <IslandHost style={{ width: '100%', height: CTA_HEIGHT }}>{button}</IslandHost>
  ) : (
    <IslandHost matchContents>{button}</IslandHost>
  );
}
