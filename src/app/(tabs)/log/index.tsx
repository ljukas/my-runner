import {
  Button,
  ContentUnavailableView,
  HStack,
  Image,
  List,
  Section,
  Spacer,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityHidden,
  accessibilityLabel,
  font,
  foregroundStyle,
  layoutPriority,
  lineLimit,
  listSectionMargins,
  listStyle,
  monospacedDigit,
} from '@expo/ui/swift-ui/modifiers';
import { desc } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';

import { Island } from '@/components/island';
import { db } from '@/db/client';
import { runIsResult } from '@/db/queries';
import { runs } from '@/db/schema';
import { clockParts, formatClock, formatRunDate, sessionTitle } from '@/domain/format';

/**
 * One combined VoiceOver label per history row. The row is a Button (so it
 * carries the button trait + a press state), but its child Text nodes stay
 * individually matchable for the text-first Maestro selectors — the same
 * pattern the Plan rows use (ADR 0016).
 */
function rowA11yLabel(run: {
  sessionKey: string;
  startedAt: string;
  status: string;
  activeDurationS: number;
}) {
  const { value, unit } = clockParts(run.activeDurationS);
  const partial = run.status === 'partial' ? 'partial, ' : '';
  return `${sessionTitle(run.sessionKey)}, ${formatRunDate(run.startedAt)}, ${partial}duration ${value} ${unit}`;
}

export default function LogScreen() {
  const router = useRouter();

  const { data: visible } = useLiveQuery(
    db.select().from(runs).where(runIsResult).orderBy(desc(runs.startedAt)),
  );

  if (visible.length === 0) {
    return (
      <Island>
        <ContentUnavailableView
          title="No runs yet"
          systemImage="figure.run"
          description="Finish your first run and it will show up here."
        />
      </Island>
    );
  }

  return (
    <Island>
      <List modifiers={[listStyle('automatic')]}>
        <Section modifiers={[listSectionMargins({ edges: 'top', length: 16 })]}>
          {visible.map((run) => (
            <Button
              key={run.id}
              modifiers={[accessibilityLabel(rowA11yLabel(run))]}
              onPress={() =>
                router.navigate({ pathname: '/run-summary/[id]', params: { id: run.id } })
              }
            >
              <HStack spacing={12}>
                <VStack alignment="leading" spacing={2}>
                  <Island.Text>{sessionTitle(run.sessionKey)}</Island.Text>
                  <Island.Text tone="secondary" modifiers={[font({ textStyle: 'footnote' })]}>
                    {formatRunDate(run.startedAt)}
                  </Island.Text>
                </VStack>
                <Spacer />
                {run.status === 'partial' ? (
                  <Island.Text
                    tone="secondary"
                    modifiers={[font({ textStyle: 'footnote' }), lineLimit(1)]}
                  >
                    Partial
                  </Island.Text>
                ) : null}
                <Island.Text modifiers={[monospacedDigit(), lineLimit(1), layoutPriority(1)]}>
                  {formatClock(run.activeDurationS)}
                </Island.Text>
                <Image
                  systemName="chevron.right"
                  modifiers={[
                    font({ textStyle: 'footnote', weight: 'semibold' }),
                    foregroundStyle({ type: 'hierarchical', style: 'tertiary' }),
                    accessibilityHidden(true),
                  ]}
                />
              </HStack>
            </Button>
          ))}
        </Section>
      </List>
    </Island>
  );
}
