import { SymbolView } from 'expo-symbols';
import { View } from 'react-native';

import { FeatureRow } from '@/components/feature-row';
import { OnboardingStepScreen } from '@/components/onboarding-step-screen';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { requestWriteAccess } from '@/services/health';

export default function HealthPrimerScreen() {
  const colors = useTheme();
  return (
    <OnboardingStepScreen
      stepId="health-primer-v1"
      buttonLabel="Connect Apple Health"
      secondaryLabel="Not Now"
      onPrimaryPress={async (advance) => {
        // requestWriteAccess catches and logs its own failures (the composition seam, ADR 0011).
        await requestWriteAccess();
        // A denial advances exactly like "Not Now" — Health is optional (ADR 0011 §4).
        advance();
      }}
      footnote={
        <Text variant="footnote" tone="secondary">
          Not Now is fine &mdash; your runs are saved here either way. You can turn this on later in
          Settings.
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
          Your runs, in Apple Health
        </Text>
      </View>
      <View className="gap-5 pt-5">
        <FeatureRow
          symbol={{ ios: 'figure.run', android: 'directions_run' }}
          title="Every run counts"
          template="primer"
        >
          Finished runs appear in Apple Health as workouts, with your distance &mdash; and your
          route too, if location is on.
        </FeatureRow>
        <FeatureRow
          symbol={{ ios: 'square.and.arrow.up', android: 'ios_share' }}
          title="Works with your other apps"
          template="primer"
        >
          Anything that reads Apple Health &mdash; your rings, other fitness apps &mdash; picks your
          runs up automatically.
        </FeatureRow>
        <FeatureRow
          symbol={{ ios: 'arrow.up.forward', android: 'arrow_outward' }}
          title="Only ever writes"
          template="primer"
        >
          RunBro adds your runs to Health and reads nothing back. Not your steps, not your heart
          rate, nothing.
        </FeatureRow>
      </View>
    </OnboardingStepScreen>
  );
}
