import { PermissionStepScreen } from '@/components/permission-step-screen';

// Android's copy deliberately differs from the iOS primer (ADR 0025); read both before editing.
export default function AudioCuesScreen() {
  return (
    <PermissionStepScreen
      stepId="audio-cues-v1"
      symbol={{ ios: 'speaker.wave.2.fill', android: 'volume_up' }}
      headline="Your pocket running coach"
      body="The coach calls out every switch between walking and running, so you never have to watch the clock."
      rows={[
        {
          symbol: { ios: 'figure.run', android: 'directions_run' },
          text: '“Start running” and “start walking”, right on time',
        },
        {
          symbol: { ios: 'music.note', android: 'music_note' },
          text: 'Plays over Spotify or YouTube Music, which just dips for a moment',
        },
        {
          symbol: { ios: 'hand.tap.fill', android: 'touch_app' },
          text: 'A gentle vibration with each cue while the screen is on',
        },
      ]}
      disclosure="Prefer quiet? Turn interval or milestone cues off anytime in Settings."
      primaryLabel="Continue"
    />
  );
}
