import { Button, Form, LabeledContent, Section, Text } from '@expo/ui/swift-ui';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';

import { Island } from '@/components/island';
import { SettingsToggle } from '@/components/settings-toggle';
import {
  healthAdapter,
  openHealthApp,
  useHealthAuthorization,
  type HealthAuthorization,
} from '@/services/health';
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

// Values deliberately share no suffix with LOCATION_ACCESS: both rows are labelled "Access", and
// ADR 0016 flows match the merged LabeledContent element by its value suffix.
const HEALTH_ACCESS: Record<HealthAuthorization, string> = {
  authorized: 'Saving Workouts',
  denied: 'Off',
  notDetermined: 'Not Set Up',
  unavailable: 'Not Available',
};

export default function SettingsScreen() {
  const router = useRouter();
  const location = useLocationPermission();
  const health = useHealthAuthorization();

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
        {/* No toggle: iOS never lets an app revoke its own HealthKit grant, so a switch that
            can be turned off but not back on would be a lie (spec §2). */}
        <Section
          title="Apple Health"
          footer={
            <Text>
              {health === 'authorized'
                ? 'Finished runs are saved to Apple Health with their route. Older runs can be saved one at a time from their summary.'
                : 'Save your finished runs to Apple Health, with distance and route. Nothing is ever read from Health.'}
            </Text>
          }
        >
          <LabeledContent label="Access">
            <Text>{HEALTH_ACCESS[health]}</Text>
          </LabeledContent>
          {health === 'notDetermined' ? (
            <Button
              label="Set Up Apple Health"
              onPress={() => void healthAdapter.requestWriteAccess()}
            />
          ) : null}
          {health === 'denied' ? (
            <Button label="Open Health" onPress={() => void openHealthApp()} />
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
