import { OnboardingStepScreen } from '@/components/onboarding-step-screen';
import { ThemedText } from '@/components/themed-text';

export default function HowItWorksScreen() {
  return (
    <OnboardingStepScreen
      stepId="how-it-works-v1"
      buttonLabel="Continue"
      buttonTestID="onboarding-continue-how-it-works">
      <ThemedText type="subtitle">How it works</ThemedText>
      <ThemedText themeColor="textSecondary">
        Three short sessions a week for nine weeks. Each one mixes walking and running — the app
        times every interval and tells you when to switch.
      </ThemedText>
      <ThemedText themeColor="textSecondary">
        The runs get gradually longer, and any session can be repeated whenever you like. By week
        nine you&apos;ll be running 30 minutes straight.
      </ThemedText>
    </OnboardingStepScreen>
  );
}
