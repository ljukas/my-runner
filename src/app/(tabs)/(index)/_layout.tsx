import { Stack } from 'expo-router';

export default function RunLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Run', headerLargeTitleEnabled: true }} />
      <Stack.Screen name="plan" options={{ title: 'Couch to 5K', headerLargeTitleEnabled: true }} />
    </Stack>
  );
}
