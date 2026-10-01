import { Stack } from 'expo-router';

// why: a deep link straight to the week list still gets a back button to the chooser
export const unstable_settings = { anchor: 'index' };

export default function RunLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Run', headerLargeTitleEnabled: true }} />
      <Stack.Screen name="plan" options={{ title: 'Couch to 5K', headerLargeTitleEnabled: true }} />
    </Stack>
  );
}
