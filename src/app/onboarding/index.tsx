import { OnboardingStepScreen } from '@/components/onboarding-step-screen';
import { ThemedText } from '@/components/themed-text';

export default function WelcomeScreen() {
  return (
    <OnboardingStepScreen
      stepId="welcome-v1"
      buttonLabel="Continue"
      buttonTestID="onboarding-continue-welcome">
      <ThemedText type="title">My Runner</ThemedText>
      <ThemedText themeColor="textSecondary">
        From the couch to 5 km in nine weeks. Free, private, and all yours — no account, no ads,
        everything stays on your phone.
      </ThemedText>
    </OnboardingStepScreen>
  );
}
