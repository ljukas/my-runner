import { Text } from '@expo/ui/jetpack-compose';
import { padding } from '@expo/ui/jetpack-compose/modifiers';

import { RUN_NOTICE_TEXT, type RunNotice } from '@/domain/run-notice';
import { useTheme } from '@/hooks/use-theme';

/** Why the last free run left no summary, as the Plan list's first item while it lasts. */
export function RunNoticeRow({ notice }: { notice: RunNotice | null }) {
  const colors = useTheme();
  if (notice === null) return null;
  return (
    <Text
      color={colors.textSecondary}
      style={{ typography: 'bodyMedium' }}
      modifiers={[padding(16, 16, 16, 4)]}
    >
      {RUN_NOTICE_TEXT[notice]}
    </Text>
  );
}
