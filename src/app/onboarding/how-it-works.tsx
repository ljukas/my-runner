import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { completeAndAdvance } from '@/services/onboarding-store';

export default function HowItWorksScreen() {
  const router = useRouter();
  return (
    <ThemedView className="flex-1 justify-between px-6 pb-16 pt-24">
      <View className="gap-4">
        <ThemedText type="subtitle">How it works</ThemedText>
        <ThemedText themeColor="textSecondary">
          Three short sessions a week for nine weeks. Each one mixes walking and running — the app
          times every interval and tells you when to switch.
        </ThemedText>
        <ThemedText themeColor="textSecondary">
          The runs get gradually longer, and any session can be repeated whenever you like. By week
          nine you&apos;ll be running 30 minutes straight.
        </ThemedText>
      </View>
      <Pressable
        testID="onboarding-continue-how-it-works"
        onPress={() => completeAndAdvance(router, 'how-it-works-v1')}
        className="items-center rounded-full bg-primary py-4">
        <ThemedText className="text-white">Continue</ThemedText>
      </Pressable>
    </ThemedView>
  );
}
