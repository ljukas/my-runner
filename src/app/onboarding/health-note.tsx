import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { completeAndAdvance } from '@/services/onboarding-store';

export default function HealthNoteScreen() {
  const router = useRouter();
  return (
    <ThemedView className="flex-1 justify-between px-6 pb-16 pt-24">
      <View className="gap-4">
        <ThemedText type="subtitle">One gentle note</ThemedText>
        <ThemedText themeColor="textSecondary">
          Couch to 5K is designed for beginners, but if you have a health condition, an old injury, or
          you&apos;re just unsure — have a quick word with your doctor before starting. Take it easy and
          listen to your body.
        </ThemedText>
      </View>
      <Pressable
        testID="onboarding-continue-health-note"
        onPress={() => completeAndAdvance(router, 'health-note-v1')}
        className="items-center rounded-full bg-primary py-4">
        <ThemedText className="text-white">Let&apos;s go</ThemedText>
      </Pressable>
    </ThemedView>
  );
}
