import { Text } from '@expo/ui/jetpack-compose';
import { padding } from '@expo/ui/jetpack-compose/modifiers';

import { useTheme } from '@/hooks/use-theme';

/** Material list subheader, for grouping rows inside a `LazyColumn`. */
export function ListSectionHeader({ title }: { title: string }) {
  const colors = useTheme();
  return (
    <Text
      color={colors.primary}
      style={{ typography: 'titleSmall' }}
      modifiers={[padding(16, 24, 16, 8)]}
    >
      {title}
    </Text>
  );
}
