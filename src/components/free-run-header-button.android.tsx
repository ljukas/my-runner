import { Island } from '@/components/island';
import { FREE_RUN_ENTRY_LABEL } from '@/domain/free-run-view';
import { useTheme } from '@/hooks/use-theme';

/** The Plan header's "New free run" action (spec §5.1). */
export function FreeRunHeaderButton({
  disabled,
  onPress,
}: {
  disabled: boolean;
  onPress: () => void;
}) {
  const colors = useTheme();
  return (
    <Island.IconButton
      systemName={{ ios: 'figure.run', android: 'directions_run' }}
      size={24}
      color={colors.text}
      label={FREE_RUN_ENTRY_LABEL}
      disabled={disabled}
      onPress={onPress}
    />
  );
}
