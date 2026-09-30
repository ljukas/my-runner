import { View } from 'react-native';

import { androidOnly } from '@/lib/android-only';
import { cn } from '@/lib/cn';
import { Island } from '@/components/island';
import { Text } from '@/components/ui/text';
import { FREE_RUN_PLAN } from '@/domain/free-run';
import { freeRunLocationLine } from '@/domain/free-run-view';
import { useStartRun } from '@/hooks/use-start-run';
import { useLocationPermission } from '@/services/location-tracker';

export default function FreeRunSheet() {
  const start = useStartRun();
  const location = useLocationPermission();

  return (
    <View className={cn('gap-6 bg-background px-6 pt-8', androidOnly('pb-safe-offset-6'))}>
      <View className="gap-1.5">
        <Text variant="subtitle" accessibilityRole="header">
          Free Run
        </Text>
        <Text variant="footnote" tone="secondary">
          Run, walk or stop as you like — the app tells them apart, and the run ends when you end
          it.
        </Text>
      </View>
      <Text tone="secondary">{freeRunLocationLine(location)}</Text>
      <Island.Button fill label="Start Free Run" onPress={() => void start(FREE_RUN_PLAN)} />
    </View>
  );
}
