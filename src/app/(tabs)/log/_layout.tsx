import { Stack } from 'expo-router';

export default function LogLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Log', headerLargeTitleEnabled: true }} />
    </Stack>
  );
}
