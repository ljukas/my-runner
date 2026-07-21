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
        <View className="gap-2">
          <SymbolView
            name={{ ios: 'slider.horizontal.3', android: 'tune' }}
            size={20}
            tintColor={colors.primary}
          />
          <Text variant="footnote" tone="secondary">
            Prefer quiet? Turn interval or milestone cues off anytime in Settings.
          </Text>
        </View>
      }
    >
      <View className="mt-6 items-center">
        <SymbolView
          name={{ ios: 'speaker.wave.2.fill', android: 'volume_up' }}
          size={72}
          tintColor={colors.primary}
        />
      </View>
      <View className="pt-9">
        <Text variant="largeTitle">Your pocket</Text>
        <Text variant="largeTitle">running coach</Text>
      </View>
      <View className="gap-6 pt-7">
        <FeatureRow
          symbol={{ ios: 'figure.run', android: 'directions_run' }}
          title="Hear every switch"
        >
          The coach calls out each change — “start running”, “start walking” — so you never have to
          watch the clock.
        </FeatureRow>
        <FeatureRow symbol={{ ios: 'music.note', android: 'music_note' }} title="Over your music">
          Cues play over Spotify or Apple Music, and you hear them even with the silent switch on —
          your music just dips for a moment.
        </FeatureRow>
        <FeatureRow symbol={{ ios: 'hand.tap.fill', android: 'touch_app' }} title="A tap to match">
          A gentle vibration accompanies each cue while the screen is on.
        </FeatureRow>
      </View>
    </OnboardingStepScreen>
  );
}
