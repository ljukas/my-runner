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
        <Section title="About">
          <LabeledContent label="Version">
            <Text>{Constants.expoConfig?.version ?? '—'}</Text>
          </LabeledContent>
        </Section>
        {__DEV__ ? (
          <Section title="Developer">
            <SettingsToggle
              label="Compressed plan"
              settingKey="useCompressedPlan"
              testID="settings-compressed-plan"
            />
            <Button label="Reset onboarding" onPress={() => resetAndRestart(router)} />
          </Section>
        ) : null}
      </Form>
    </Island>
  );
}
