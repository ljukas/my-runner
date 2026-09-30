import { Stack } from 'expo-router';

import { FreeRunHeaderButton } from '@/components/free-run-header-button';
import { useFreeRunEntry } from '@/hooks/use-free-run-entry';

// why a fork: an SF-Symbol toolbar button renders nothing on Android, so the entry is a header view
export default function PlanLayout() {
  const entry = useFreeRunEntry();
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: 'Plan',
          headerRight: () => <FreeRunHeaderButton disabled={entry.disabled} onPress={entry.open} />,
        }}
      />
    </Stack>
  );
}
