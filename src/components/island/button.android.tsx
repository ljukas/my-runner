import { Button, OutlinedButton, Text } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, height, testID as testIDModifier } from '@expo/ui/jetpack-compose/modifiers';

import { useTheme } from '@/hooks/use-theme';

import { IslandHost } from './host';

type IslandButtonVariant = 'primary' | 'secondary' | 'destructive';

const CTA_HEIGHT = 52;

/**
 * Standalone by default; `inline` renders bare for an existing Compose tree.
 * Compose reports its own size, so `fill` needs none of the iOS height arithmetic.
 */
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

  return fill ? (
    <IslandHost matchContents={{ vertical: true }} style={{ width: '100%' }}>
      {button}
    </IslandHost>
  ) : (
    <IslandHost matchContents>{button}</IslandHost>
  );
}
