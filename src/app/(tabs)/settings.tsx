import { Form, Host, LabeledContent, Section, Text, Toggle } from '@expo/ui/swift-ui';
import Constants from 'expo-constants';

import { settingsStore, useSetting } from '@/services/settings-store';

export default function SettingsScreen() {
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
          </Section>
        ) : null}
      </Form>
    </Host>
  );
}
