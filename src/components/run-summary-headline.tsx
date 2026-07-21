import { View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import type { Run } from '@/db/schema';
import { formatRunDate } from '@/domain/format';
import { cn } from '@/lib/cn';

/**
 * The row above the run summary's stats (ADR 0013 domain component): a
 * celebratory line on a fresh finish, the run date on a Log revisit, with the
 * completed/partial status badge trailing in both.
 */
export function RunSummaryHeadline({ run, celebrate }: { run: Run; celebrate: boolean }) {
  const completed = run.status === 'completed';
  return (
    <View className="flex-row flex-wrap items-center justify-between gap-2">
      {celebrate ? (
        // P: Body-scale semibold (was 14 px smallBold, smaller than the date it
        // replaces). D: completed wears the green success accent (matching the
        // Plan completed-checkmarks); partial keeps the primary accent.
        <Text
          variant="default"
          className={cn('font-semibold', completed ? 'text-success' : 'text-primary')}
        >
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
