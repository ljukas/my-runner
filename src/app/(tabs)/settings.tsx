import { Button, Form, Host, LabeledContent, Section, Text, Toggle } from '@expo/ui/swift-ui';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

import { resetAndRestart } from '@/services/onboarding-store';
import { settingsStore, useSetting } from '@/services/settings-store';

export default function SettingsScreen() {
  const router = useRouter();
  const compressed = useSetting('useCompressedPlan');

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <Form>
        <Section title="About">
          <LabeledContent label="Version">
            <Text>{Constants.expoConfig?.version ?? '—'}</Text>
          </LabeledContent>
        </Section>
        {__DEV__ ? (
          <Section title="Developer">
            <Toggle
              testID="settings-compressed-plan"
              label="Compressed plan"
              isOn={compressed}
              onIsOnChange={(value) => settingsStore.set('useCompressedPlan', value)}
            />
            <Button
              testID="settings-reset-onboarding"
              label="Reset onboarding"
              onPress={() => resetAndRestart(router)}
            />
          </Section>
        ) : null}
      </Form>
    </Host>
  );
}
