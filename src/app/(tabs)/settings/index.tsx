import { Button, Form, LabeledContent, Section, Text } from '@expo/ui/swift-ui';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

import { Island } from '@/components/island';
import { SettingsToggle } from '@/components/settings-toggle';
import { resetAndRestart } from '@/services/onboarding-store';

export default function SettingsScreen() {
  const router = useRouter();

  return (
    <Island useViewportSizeMeasurement>
      <Form>
        <Section
          title="About"
          footer={<Text>No account, no sign-in. Your runs stay on this device.</Text>}
        >
          <LabeledContent label="Version">
            <Text>{Constants.expoConfig?.version ?? '—'}</Text>
          </LabeledContent>
        </Section>
        <Section title="Display">
          <SettingsToggle label="Keep screen awake" settingKey="keepScreenAwake" />
        </Section>
        <Section
          title="Coaching"
          footer={
            <Text>
              Interval Cues call out each walk/run switch. Milestone Cues add motivational spots —
              halfway, your last run, and finishing.
            </Text>
          }
        >
          <SettingsToggle label="Interval Cues" settingKey="intervalCuesEnabled" />
          <SettingsToggle label="Milestone Cues" settingKey="milestoneCuesEnabled" />
        </Section>
        {__DEV__ ? (
          <Section title="Developer">
            <SettingsToggle label="Compressed Plan" settingKey="useCompressedPlan" />
            <Button label="Reset Onboarding" onPress={() => resetAndRestart(router)} />
          </Section>
        ) : null}
      </Form>
    </Island>
  );
}
