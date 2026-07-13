import { SymbolView } from 'expo-symbols';
import { Image, View } from 'react-native';

import { FeatureRow } from '@/components/feature-row';
import { OnboardingStepScreen } from '@/components/onboarding-step-screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export default function WelcomeScreen() {
  const colors = useTheme();
  return (
    <OnboardingStepScreen
      stepId="welcome-v1"
      buttonLabel="Continue"
      buttonTestID="onboarding-continue-welcome"
      footnote={
        <View className="gap-2">
          <SymbolView
            name={{ ios: 'heart.text.square', android: 'favorite' }}
            size={20}
            tintColor={colors.primary}
          />
          <ThemedText type="footnote" themeColor="textSecondary">
            Couch to 5K is designed for beginners. If you have a health condition or an old
            injury, have a quick word with your doctor before starting — and listen to your body.
          </ThemedText>
        </View>
      }>
      <Image
        source={require('@/assets/images/icon.png')}
        className="mt-6 h-[88px] w-[88px] self-center rounded-[20px]"
        style={{ borderCurve: 'continuous' } as any}
      />
      <View className="pt-9">
        <ThemedText type="largeTitle" themeColor="primary">
          Welcome to
        </ThemedText>
        <ThemedText type="largeTitle">My Runner</ThemedText>
      </View>
      <View className="gap-6 pt-7">
        <FeatureRow symbol={{ ios: 'figure.run', android: 'directions_run' }} title="From Couch to 5 km">
          Three short sessions a week for nine weeks — walking at first, running 30 minutes
          straight by the end.
        </FeatureRow>
        <FeatureRow symbol={{ ios: 'timer', android: 'timer' }} title="Guided Intervals">
          The app times every walk and run and tells you exactly when to switch.
        </FeatureRow>
        <FeatureRow symbol={{ ios: 'lock.fill', android: 'lock' }} title="Private and Free">
          No account, no ads, no tracking — everything stays on your phone.
        </FeatureRow>
      </View>
    </OnboardingStepScreen>
  );
}
