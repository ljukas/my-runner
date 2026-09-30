import { Stack } from 'expo-router';

import { FREE_RUN_ENTRY_LABEL } from '@/domain/free-run-view';
import { useFreeRunEntry } from '@/hooks/use-free-run-entry';

export default function PlanLayout() {
  const entry = useFreeRunEntry();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Plan', headerLargeTitleEnabled: true }}>
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="figure.run"
            accessibilityLabel={FREE_RUN_ENTRY_LABEL}
            disabled={entry.disabled}
            onPress={entry.open}
          />
        </Stack.Toolbar>
      </Stack.Screen>
    </Stack>
  );
}
