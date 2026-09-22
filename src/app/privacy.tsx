import { ScrollView } from 'react-native';

import { PrivacyPolicy } from '@/components/privacy-policy';

export default function PrivacyScreen() {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="bg-background"
      contentContainerClassName="px-6 pt-4 pb-safe-offset-6 android:pb-safe-offset-10"
    >
      <PrivacyPolicy />
    </ScrollView>
  );
}
