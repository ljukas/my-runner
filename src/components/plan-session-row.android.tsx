import { ListItem, Text, useMaterialColors } from '@expo/ui/jetpack-compose';
import { clickable } from '@expo/ui/jetpack-compose/modifiers';

import { formatMinutes } from '@/domain/format';
import { sessionTotalSeconds, type PlanSession } from '@/domain/plan';

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
  // Inside the Island, so this is the Host's own (wallpaper-derived) palette.
  const m = useMaterialColors();
  const state = completed ? 'Completed' : isNext ? 'Up next' : 'Not started';
  return (
    <ListItem
      modifiers={[clickable(onPress)]}
      colors={
        isNext
          ? { containerColor: m.secondaryContainer, contentColor: m.onSecondaryContainer }
          : undefined
      }
    >
      <ListItem.HeadlineContent>
        <Text>{`Day ${session.day}`}</Text>
      </ListItem.HeadlineContent>
      <ListItem.SupportingContent>
        <Text>{state}</Text>
      </ListItem.SupportingContent>
      <ListItem.TrailingContent>
        <Text>{formatMinutes(sessionTotalSeconds(session))}</Text>
      </ListItem.TrailingContent>
    </ListItem>
  );
}
