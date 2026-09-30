import { ScrollView } from 'react-native';

import { androidOnly } from '@/lib/android-only';
import { cn } from '@/lib/cn';
import { PrivacyPolicy } from '@/components/privacy-policy';

export default function PrivacyScreen() {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="bg-background"
      contentContainerClassName={cn('px-6 pt-4', androidOnly('pb-safe-offset-10') ?? 'pb-6')}
    >
      <PrivacyPolicy />
    </ScrollView>
  );
}
