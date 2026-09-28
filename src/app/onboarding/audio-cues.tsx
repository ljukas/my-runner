import { SymbolView } from 'expo-symbols';
import { View } from 'react-native';

import { FeatureRow } from '@/components/feature-row';
import { OnboardingStepScreen } from '@/components/onboarding-step-screen';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';

export default function AudioCuesScreen() {
  const colors = useTheme();
  return (
    <OnboardingStepScreen
      stepId="audio-cues-v1"
      buttonLabel="Continue"
      footnote={
        <Text variant="footnote" tone="secondary">
          Prefer quiet? Turn interval or milestone cues off anytime in Settings.
        </Text>
      }
    >
      <View className="items-center">
        <SymbolView
          name={{ ios: 'speaker.wave.2.fill', android: 'volume_up' }}
          size={64}
          tintColor={colors.primary}
        />
      </View>
      <View className="pt-10">
        <Text variant="title1" accessibilityRole="header">
          Your pocket running coach
        </Text>
      </View>
      <View className="gap-5 pt-5">
        <FeatureRow
          symbol={{ ios: 'figure.run', android: 'directions_run' }}
          title="Hear every switch"
          template="primer"
        >
          The coach calls out each change — “start running”, “start walking” — so you never have to
          watch the clock.
        </FeatureRow>
        <FeatureRow
          symbol={{ ios: 'music.note', android: 'music_note' }}
          title="Over your music"
          template="primer"
        >
          Cues play over Spotify or Apple Music, and you hear them even with the silent switch on —
          your music just dips for a moment.
        </FeatureRow>
        <FeatureRow
          symbol={{ ios: 'hand.tap.fill', android: 'touch_app' }}
          title="A tap to match"
          template="primer"
        >
          A gentle vibration accompanies each cue while the screen is on.
        </FeatureRow>
      </View>
    </OnboardingStepScreen>
  );
}
