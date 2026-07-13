import { Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';

/** The app's primary pill call-to-action, shared by onboarding and the run summary. */
export function PrimaryButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="items-center rounded-full bg-primary py-4">
      <ThemedText className="text-white">{label}</ThemedText>
    </Pressable>
  );
}
