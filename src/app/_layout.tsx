import '@/global.css';

import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { db } from '@/db/client';
import migrations from '@/db/migrations/migrations';
import { onboarding } from '@/services/onboarding-store';

void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 400, fade: true });

/** Pushes the first pending onboarding step as a full-screen modal over the tabs. */
function OnboardingGate() {
  const router = useRouter();
  useEffect(() => {
    const pending = onboarding.pendingSteps();
    if (pending.length > 0) {
      router.push(pending[0].route);
    }
  }, [router]);
  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { success, error } = useMigrations(db, migrations);

  useEffect(() => {
    if (success || error) SplashScreen.hide();
  }, [success, error]);

  if (error) {
    return (
      <ThemedView className="flex-1 items-center justify-center px-8">
        <ThemedText>Something went wrong preparing the database.</ThemedText>
        <ThemedText themeColor="textSecondary" className="mt-2">
          {error.message}
        </ThemedText>
      </ThemedView>
    );
  }
  if (!success) return null; // splash stays up

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <OnboardingGate />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="session/[key]"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.5, 0.95],
            sheetInitialDetentIndex: 0,
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="run"
          options={{ presentation: 'fullScreenModal', gestureEnabled: false }}
        />
        <Stack.Screen
          name="run-summary"
          options={{ presentation: 'fullScreenModal', gestureEnabled: false }}
        />
        <Stack.Screen
          name="onboarding"
          options={{ presentation: 'fullScreenModal', gestureEnabled: false }}
        />
      </Stack>
    </ThemeProvider>
  );
}
