import { View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import type { Run } from '@/db/schema';
import { formatRunDate } from '@/domain/format';

/**
 * The row above the run summary's stats (ADR 0013 domain component): a
 * celebratory line on a fresh finish, the run date on a Log revisit, with the
 * completed/partial status badge trailing in both.
 */
export function RunSummaryHeadline({ run, celebrate }: { run: Run; celebrate: boolean }) {
  const completed = run.status === 'completed';
  return (
    <View className="flex-row items-center justify-between">
      {celebrate ? (
        <Text variant="smallBold" tone="primary">
          {completed ? 'Nice work! 🎉' : 'Good effort! 💪'}
        </Text>
      ) : (
        <Text tone="secondary">{formatRunDate(run.startedAt)}</Text>
      )}
      <Badge
        className="bg-background-card"
        tone={completed ? 'positive' : 'neutral'}
        label={completed ? 'Completed' : 'Partial'}
      />
    </View>
  );
}
