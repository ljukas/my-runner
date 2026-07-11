import * as Device from 'expo-device';
import { Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

import { AnimatedIcon } from '@/components/animated-icon';
import { HintRow } from '@/components/hint-row';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';

const StyledSafeAreaView = withUniwind(SafeAreaView);

function getDevMenuHint() {
  if (Device.isDevice) {
    return (
      <ThemedText type="small">
        shake device or press <ThemedText type="code">m</ThemedText> in terminal
      </ThemedText>
    );
  }
  const shortcut = Platform.OS === 'android' ? 'cmd+m (or ctrl+m)' : 'cmd+d';
  return (
    <ThemedText type="small">
      press <ThemedText type="code">{shortcut}</ThemedText>
    </ThemedText>
  );
}

export default function HomeScreen() {
  return (
    <View className="flex-1 flex-row justify-center bg-background">
      <StyledSafeAreaView
        className="max-w-[800px] flex-1 items-center gap-4 px-6"
        style={{ paddingBottom: BottomTabInset + Spacing.three }}
      >
        <View className="flex-1 items-center justify-center gap-6 px-6">
          <AnimatedIcon />
          <ThemedText type="title" className="text-center">
            Welcome to&nbsp;Expo
          </ThemedText>
        </View>

        <ThemedText type="code" className="uppercase">
          get started
        </ThemedText>

        <View className="gap-4 self-stretch rounded-3xl bg-background-element px-4 py-6">
          <HintRow
            title="Try editing"
            hint={<ThemedText type="code">src/app/index.tsx</ThemedText>}
          />
          <HintRow title="Dev tools" hint={getDevMenuHint()} />
          <HintRow
            title="Fresh start"
            hint={<ThemedText type="code">bun expo start --clear</ThemedText>}
          />
        </View>

      </StyledSafeAreaView>
    </View>
  );
}
