import { ScrollView } from 'react-native';

import { PrivacyPolicy } from '@/components/privacy-policy';

/** The privacy policy, reachable from Android Settings and Health Connect's rationale link. */
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
