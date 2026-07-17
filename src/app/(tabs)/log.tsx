import { ContentUnavailableView, HStack, List, Spacer, VStack } from '@expo/ui/swift-ui';
import {
  contentShape,
  font,
  monospacedDigit,
  onTapGesture,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { desc } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';

import { Island } from '@/components/island';
import { db } from '@/db/client';
import { runNotDeleted } from '@/db/queries';
import { runs } from '@/db/schema';
import { formatClock, sessionTitle } from '@/domain/format';

export default function LogScreen() {
  const router = useRouter();
  const { data: visible } = useLiveQuery(
    db.select().from(runs).where(runNotDeleted).orderBy(desc(runs.startedAt)),
  );

  if (visible.length === 0) {
    return (
      <Island>
        <ContentUnavailableView
          title="No runs yet"
          systemImage="figure.run"
          description="Finish your first session and it will show up here."
        />
      </Island>
    );
  }

  return (
    <Island>
      <List>
        {visible.map((run) => (
          <HStack
            key={run.id}
            spacing={12}
            modifiers={[
              contentShape(shapes.rectangle()),
              onTapGesture(() =>
                router.navigate({ pathname: '/run-summary/[id]', params: { id: run.id } }),
              ),
            ]}
          >
            <VStack alignment="leading" spacing={2}>
              <Island.Text>{sessionTitle(run.sessionKey)}</Island.Text>
              <Island.Text tone="secondary" modifiers={[font({ textStyle: 'footnote' })]}>
                {new Date(run.startedAt).toLocaleDateString()}
              </Island.Text>
            </VStack>
            <Spacer />
            {run.status === 'partial' ? (
              <Island.Text tone="secondary" modifiers={[font({ textStyle: 'footnote' })]}>
                Partial
              </Island.Text>
            ) : null}
            <Island.Text modifiers={[monospacedDigit()]}>
              {formatClock(run.activeDurationS)}
            </Island.Text>
          </HStack>
        ))}
      </List>
    </Island>
  );
}
