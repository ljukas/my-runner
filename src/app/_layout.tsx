import '@/global.css';

import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme, View } from 'react-native';

import { ResumeRunGate } from '@/components/resume-run-gate';
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
      <ResumeRunGate />
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
          name="resume-run"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: 'fitToContents',
            // Not swipe-dismissible: an undecided dismissal would leave the run `'active'` and invisible.
            gestureEnabled: false,
            headerShown: false,
            contentStyle: {
              backgroundColor: Colors[colorScheme === 'dark' ? 'dark' : 'light'].background,
            },
          }}
        />
        <Stack.Screen
          name="run"
          options={{ presentation: 'fullScreenModal', gestureEnabled: false, headerShown: false }}
        />

        <Stack.Screen
          name="runs/[runId]/index"
          options={{ presentation: 'modal', headerLargeTitleEnabled: true, title: '' }}
        >
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button
              icon="xmark"
              accessibilityLabel="Close"
              onPress={() => router.dismissAll()}
            />
          </Stack.Toolbar>
        </Stack.Screen>

        <Stack.Screen
          name="runs/[runId]/route"
          options={{
            presentation: 'modal',
            title: 'Route',
            headerTransparent: true,
            // why empty: the map runs full-bleed under the bar, and a title over it would only
            // restate the view. Costs the a11y screen name, which the map's own label carries
            // instead (spec §7.1 amendment).
            headerTitle: '',
          }}
        >
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button
              icon="xmark"
              accessibilityLabel="Close map"
              // why: a cold deep link has no back entry; fall back to dismissTo so the swipe isn't
              // the only exit (spec §7.4).
              onPress={() => (router.canGoBack() ? router.back() : router.dismissTo('/log'))}
            />
          </Stack.Toolbar>
        </Stack.Screen>

        <Stack.Screen
          name="onboarding"
          options={{ presentation: 'modal', gestureEnabled: false, headerShown: false }}
        />
      </Stack>
    </ThemeProvider>
  );
}
