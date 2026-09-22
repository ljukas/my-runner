import { SymbolView } from 'expo-symbols';
import { View } from 'react-native';

import { FeatureRow } from '@/components/feature-row';
import { OnboardingStepScreen } from '@/components/onboarding-step-screen';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { requestWriteAccess } from '@/services/health';

// Health Connect's onboarding guidance is educate → consent → request, and asks that the data
// types written be named up front (carousel design §5.4) — hence the three rows below.
export default function HealthPrimerScreen() {
  const colors = useTheme();
  return (
    <OnboardingStepScreen
      stepId="health-primer-v1"
      buttonLabel="Set up Health Connect"
      secondaryLabel="Not Now"
      onPrimaryPress={async (advance) => {
        // requestWriteAccess catches and logs its own failures (the composition seam, ADR 0011).
        await requestWriteAccess();
        // A refusal advances exactly like "Not Now" — Health Connect is optional (ADR 0011 §4).
        advance();
      }}
      footnote={
        <Text variant="footnote" tone="secondary">
          Not Now is fine &mdash; your runs are saved here either way. You can set this up later in
          Settings, and change what RunBro may write at any time in Health Connect.
        </Text>
      }
    >
      <View className="items-center">
        <SymbolView
          name={{ ios: 'heart.fill', android: 'favorite' }}
          size={64}
          tintColor={colors.primary}
        />
      </View>
      <View className="pt-10">
        <Text variant="title1" accessibilityRole="header">
          Your runs, in Health Connect
        </Text>
      </View>
      <View className="gap-5 pt-5">
        <FeatureRow
          symbol={{ ios: 'figure.run', android: 'directions_run' }}
          title="Exercise sessions"
          template="primer"
        >
          Each finished run is saved as a running session, so any app that reads Health Connect
          &mdash; Fitbit, Google Fit, your watch&rsquo;s &mdash; picks it up.
        </FeatureRow>
        <FeatureRow
          symbol={{ ios: 'map.fill', android: 'route' }}
          title="Distance and route"
          template="primer"
        >
          The distance you covered, and your route too if location is on.
        </FeatureRow>
        <FeatureRow
          symbol={{ ios: 'arrow.up.forward', android: 'arrow_outward' }}
          title="Only ever writes"
          template="primer"
        >
          RunBro adds your runs to Health Connect and reads nothing back. Not your steps, not your
          heart rate, nothing.
        </FeatureRow>
      </View>
    </OnboardingStepScreen>
  );
}
