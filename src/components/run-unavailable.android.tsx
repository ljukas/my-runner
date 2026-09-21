import { type AndroidSymbol, SymbolView } from 'expo-symbols';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';

export type RunUnavailableReason = 'unsaved' | 'missing' | 'no-route';

const COPY: Record<
  RunUnavailableReason,
  { title: string; icon: AndroidSymbol; description: string }
> = {
  unsaved: {
    title: 'Run not saved',
    icon: 'warning',
    description: "This run couldn't be saved.",
  },
  missing: {
    title: 'Run unavailable',
    icon: 'help',
    description: "This run isn't available.",
  },
  'no-route': {
    title: 'No route',
    icon: 'map',
    description: "There's no map for this run.",
  },
};

/** The empty state shared by the run summary and the route viewer; see the iOS file for `missing`. */
export function RunUnavailable({ reason }: { reason: RunUnavailableReason }) {
  const colors = useTheme();
  const { title, icon, description } = COPY[reason];
  return (
    <View className="flex-1 items-center justify-center gap-2 px-8">
      <SymbolView name={{ android: icon }} size={48} tintColor={colors.textSecondary} />
      <Text variant="title2">{title}</Text>
      <Text tone="secondary" className="text-center">
        {description}
      </Text>
    </View>
  );
}
