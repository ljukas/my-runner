import '@/global.css';

import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { db } from '@/db/client';
import migrations from '@/db/migrations/migrations';
import { useTheme } from '@/hooks/use-theme';
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
  const router = useRouter();

  const colors = useTheme();

  useEffect(() => {
    if (success || error) SplashScreen.hide();
  }, [success, error]);

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8">
        <Text>Something went wrong preparing the database.</Text>
        <Text tone="secondary" className="mt-2">
          {error.message}
        </Text>
      </View>
    );
  }
  if (!success) return null; // splash stays up

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <OnboardingGate />
      <Stack
        screenOptions={{
          headerLargeTitleStyle: { color: colors.text },
          headerTitleStyle: { color: colors.text },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="session/[key]"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: 'fitToContents',
            sheetGrabberVisible: true,
            headerShown: false,
            // Paint the whole sheet container (incl. the bottom safe-area inset the
            // content view no longer covers under fitToContents) with the theme background.
            contentStyle: {
              backgroundColor: Colors[colorScheme === 'dark' ? 'dark' : 'light'].background,
            },
          }}
        />
        <Stack.Screen
          name="run"
          options={{ presentation: 'fullScreenModal', gestureEnabled: false }}
        />

        <Stack.Screen
          name="run-summary/[id]"
          options={{ presentation: 'modal', headerLargeTitleEnabled: true }}
        >
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button icon="xmark" onPress={() => router.dismissAll()} />
          </Stack.Toolbar>
        </Stack.Screen>

        <Stack.Screen
          name="onboarding"
          options={{ presentation: 'modal', gestureEnabled: false }}
        />
      </Stack>
    </ThemeProvider>
  );
}
