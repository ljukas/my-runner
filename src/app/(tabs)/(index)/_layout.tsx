import { Stack } from 'expo-router';

export default function PlanLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Plan', headerLargeTitleEnabled: true }} />
    </Stack>
  );
}
