import { Button, Form, LabeledContent, Section, Text } from '@expo/ui/swift-ui';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';

import { Island } from '@/components/island';
import { SettingsToggle } from '@/components/settings-toggle';
import {
  useLocationPermission,
  locationTracker,
  type LocationPermissionStatus,
} from '@/services/location-tracker';
import { resetAndRestart } from '@/services/onboarding-store';

const LOCATION_ACCESS: Record<LocationPermissionStatus, string> = {
  granted: 'While Using the App',
  denied: 'Never',
  undetermined: 'Ask Next Time Or When I Share',
};

export default function SettingsScreen() {
  const router = useRouter();
  const location = useLocationPermission();

  return (
    <Island useViewportSizeMeasurement>
      <Form>
        <Section
          title="Coaching"
          footer={
            <Text>
              Interval Cues call out each walk/run switch. Milestone Cues add motivational spots —
              halfway, your last run, and finishing. A gentle vibration accompanies each cue while
              the screen is on — lock the run screen to keep it on.
            </Text>
          }
        >
          <SettingsToggle label="Interval Cues" settingKey="intervalCuesEnabled" />
          <SettingsToggle label="Milestone Cues" settingKey="milestoneCuesEnabled" />
        </Section>
        {/* No toggle: only iOS can grant this, so the row reports and defers to system Settings. */}
        <Section
          title="Location"
          footer={
            <Text>
              {location === 'granted'
                ? 'Location measures your distance and route, and keeps cues playing while your phone is locked.'
                : "Without location, runs are still timed correctly — but distance isn't recorded, and cues stop once the screen sleeps. Lock the run screen to keep them playing."}
            </Text>
          }
        >
          <LabeledContent label="Access">
            <Text>{location ? LOCATION_ACCESS[location] : '—'}</Text>
          </LabeledContent>
          {location === 'denied' ? (
            <Button label="Open Settings" onPress={() => void Linking.openSettings()} />
          ) : null}
          {location === 'undetermined' ? (
            <Button
              label="Enable Location"
              onPress={() => void locationTracker.requestPermission()}
            />
          ) : null}
        </Section>
        <Section
          title="About"
          footer={<Text>No account, no sign-in. Your runs stay on this device.</Text>}
        >
          <LabeledContent label="Version">
            <Text>{Constants.expoConfig?.version ?? '—'}</Text>
          </LabeledContent>
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
