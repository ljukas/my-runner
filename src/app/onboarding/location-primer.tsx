import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { View } from 'react-native';

import { FeatureRow } from '@/components/feature-row';
import { OnboardingStepScreen } from '@/components/onboarding-step-screen';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { locationTracker } from '@/services/location-tracker';
import { completeAndAdvance } from '@/services/onboarding-store';

export default function LocationPrimerScreen() {
  const colors = useTheme();
  const router = useRouter();
  return (
    <OnboardingStepScreen
      stepId="location-primer-v1"
      buttonLabel="Enable Location"
      // "Not Now" needs no handler: skipping is just advancing, and the just-in-time ask at the
      // first run start is the second chance (ADR 0008 §2).
      secondaryLabel="Not Now"
      onPrimaryPress={async () => {
        try {
          await locationTracker.requestPermission();
        } catch (error) {
          console.warn('[onboarding] location prompt failed', error);
        }
        // A denial advances exactly like "Not Now" — location is optional (ADR 0008 §5).
        completeAndAdvance(router, 'location-primer-v1');
      }}
      footnote={
        <Text variant="footnote" tone="secondary">
          Not Now is fine &mdash; every run is still timed, but runs won&rsquo;t have distance and
          cues stop once the screen sleeps. You can change this later in Settings.
        </Text>
      }
    >
      <View className="items-center">
        <SymbolView
          name={{ ios: 'location.fill', android: 'my_location' }}
          size={64}
          tintColor={colors.primary}
        />
      </View>
      <View className="pt-10">
        <Text variant="title1" accessibilityRole="header">
          Track your route and your pace
        </Text>
      </View>
      <View className="gap-5 pt-5">
        <FeatureRow
          symbol={{ ios: 'map.fill', android: 'map' }}
          title="Distance and pace"
          template="primer"
        >
          Every run records how far you went and how fast, so you can watch yourself getting
          stronger week by week.
        </FeatureRow>
        <FeatureRow
          symbol={{ ios: 'lock.iphone', android: 'phonelink_lock' }}
          title="Coaching in your pocket"
          template="primer"
        >
          Location is what lets the coach keep talking after your screen turns off — put the phone
          away and just listen.
        </FeatureRow>
        <FeatureRow
          symbol={{ ios: 'hand.raised.fill', android: 'front_hand' }}
          title="Stays on your phone"
          template="primer"
        >
          Your route never leaves this device. No account, no servers, nothing shared.
        </FeatureRow>
      </View>
    </OnboardingStepScreen>
  );
}
