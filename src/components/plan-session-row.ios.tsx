import { Button, HStack, Image, Spacer } from '@expo/ui/swift-ui';
import { accessibilityLabel, font } from '@expo/ui/swift-ui/modifiers';

import { Island } from '@/components/island';
import { formatMinutes } from '@/domain/format';
import { sessionTotalSeconds, type PlanSession } from '@/domain/plan';
import { useTheme } from '@/hooks/use-theme';

export function PlanSessionRow({
  session,
  completed,
  isNext,
  onPress,
}: {
  session: PlanSession;
  completed: boolean;
  isNext: boolean;
  onPress: () => void;
}) {
  const colors = useTheme();
  const state = completed ? 'completed' : isNext ? 'up next' : 'not started';
  const duration = formatMinutes(sessionTotalSeconds(session));
  return (
    <Button
      onPress={onPress}
      modifiers={[accessibilityLabel(`Day ${session.day}, ${state}, ${duration}`)]}
    >
      <HStack spacing={12}>
        <Island.Label
          systemImage={completed ? 'checkmark.circle.fill' : 'circle'}
          iconTone={completed ? 'success' : 'secondary'}
          title={`Day ${session.day}`}
          decorativeIcon
        />
        <Spacer />
        {isNext ? (
          // E2E escape hatch (ADR 0016): icon-only, no text to target. Kept in the
          // a11y tree (not hidden) so Maestro's `id: plan-next-*` assertion holds;
          // labelled "Up next" so VoiceOver doesn't read the raw SF Symbol name.
          <Image
            testID={`plan-next-${session.key}`}
            systemName="arrow.forward.circle.fill"
            color={colors.primary}
            modifiers={[font({ textStyle: 'title3' }), accessibilityLabel('Up next')]}
          />
        ) : null}
        <Island.Text tone="secondary">{duration}</Island.Text>
      </HStack>
    </Button>
  );
}
