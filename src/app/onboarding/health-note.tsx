import { OnboardingStepScreen } from '@/components/onboarding-step-screen';
import { ThemedText } from '@/components/themed-text';

export default function HealthNoteScreen() {
  return (
    <OnboardingStepScreen
      stepId="health-note-v1"
      buttonLabel="Let's go"
      buttonTestID="onboarding-continue-health-note">
      <ThemedText type="subtitle">One gentle note</ThemedText>
      <ThemedText themeColor="textSecondary">
        Couch to 5K is designed for beginners, but if you have a health condition, an old injury, or
        you&apos;re just unsure — have a quick word with your doctor before starting. Take it easy and
        listen to your body.
      </ThemedText>
    </OnboardingStepScreen>
  );
}
