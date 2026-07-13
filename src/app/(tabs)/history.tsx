import {
  ContentUnavailableView,
  HStack,
  Host,
  List,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import { font, foregroundColor, monospacedDigit } from '@expo/ui/swift-ui/modifiers';
import { desc } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '@/db/client';
import { runNotDeleted } from '@/db/queries';
import { runs } from '@/db/schema';
import { formatClock, sessionTitle } from '@/domain/format';
import { useTheme } from '@/hooks/use-theme';

export default function HistoryScreen() {
  const colors = useTheme();
  const { data: visible } = useLiveQuery(
    db.select().from(runs).where(runNotDeleted).orderBy(desc(runs.startedAt)),
  );

  if (visible.length === 0) {
    return (
      <Host style={{ flex: 1 }}>
        <ContentUnavailableView
          title="No runs yet"
          systemImage="figure.run"
          description="Finish your first session and it will show up here."
        />
      </Host>
    );
  }

  return (
    <Host style={{ flex: 1 }}>
      <List>
        {visible.map((run) => (
          <HStack key={run.id} spacing={12}>
            <VStack alignment="leading" spacing={2}>
              <Text modifiers={[foregroundColor(colors.text)]}>{sessionTitle(run.sessionKey)}</Text>
              <Text
                modifiers={[font({ textStyle: 'footnote' }), foregroundColor(colors.textSecondary)]}
              >
                {new Date(run.startedAt).toLocaleDateString()}
              </Text>
            </VStack>
            <Spacer />
            {run.status === 'partial' ? (
              <Text
                modifiers={[font({ textStyle: 'footnote' }), foregroundColor(colors.textSecondary)]}
              >
                Partial
              </Text>
            ) : null}
            <Text modifiers={[monospacedDigit(), foregroundColor(colors.text)]}>
              {formatClock(run.activeDurationS)}
            </Text>
          </HStack>
        ))}
      </List>
    </Host>
  );
}
