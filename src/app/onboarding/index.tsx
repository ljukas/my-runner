import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { completeAndAdvance } from '@/services/onboarding-store';

export default function WelcomeScreen() {
  const router = useRouter();
  return (
    <ThemedView className="flex-1 justify-between px-6 pb-16 pt-24">
      <View className="gap-4">
        <ThemedText type="title">My Runner</ThemedText>
        <ThemedText themeColor="textSecondary">
          From the couch to 5 km in nine weeks. Free, private, and all yours — no account, no ads,
          everything stays on your phone.
        </ThemedText>
      </View>
      <Pressable
        testID="onboarding-continue-welcome"
        onPress={() => completeAndAdvance(router, 'welcome-v1')}
        className="items-center rounded-full bg-primary py-4">
        <ThemedText className="text-white">Continue</ThemedText>
      </Pressable>
    </ThemedView>
  );
}
