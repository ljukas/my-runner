import { LazyColumn, ListItem, Text } from '@expo/ui/jetpack-compose';
import { background, clickable, fillMaxSize } from '@expo/ui/jetpack-compose/modifiers';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';

import { FieldTestRow } from '@/components/field-test-row';
import { Island } from '@/components/island';
import { ListSectionHeader } from '@/components/list-section-header';
import { SettingsToggle } from '@/components/settings-toggle';
import { useTheme } from '@/hooks/use-theme';
import { isFieldTestBuild } from '@/services/field-test';
import {
  openHealthApp,
  requestWriteAccess,
  useHealthAuthorization,
  type HealthAuthorization,
} from '@/services/health';
import {
  locationTracker,
  useLocationPermission,
  type LocationPermissionStatus,
} from '@/services/location-tracker';
import { resetAndRestart } from '@/services/onboarding-store';

const LOCATION_ACCESS: Record<LocationPermissionStatus, string> = {
  granted: 'While using the app',
  denied: 'Denied in Settings',
  undetermined: 'Not enabled',
  unsupported: 'Not available',
};

const HEALTH_ACCESS: Record<HealthAuthorization, string> = {
  authorized: 'Saving workouts',
  denied: 'Off',
  notDetermined: 'Not set up',
  unavailable: 'Not available',
};

export default function SettingsScreen() {
  const router = useRouter();
  const colors = useTheme();
  const location = useLocationPermission();
  const health = useHealthAuthorization();

  return (
    <Island>
      <LazyColumn
        modifiers={[fillMaxSize(), background(colors.background)]}
        contentPadding={{ bottom: 24 }}
      >
        <ListSectionHeader title="Coaching" />
        <SettingsToggle
          label="Interval cues"
          description="Interval cues call out each walk/run switch."
          settingKey="intervalCuesEnabled"
        />
        <SettingsToggle
          label="Milestone cues"
          description="Milestone cues add motivational spots — halfway, your last run, and finishing. A gentle vibration accompanies each cue while the screen is on."
          settingKey="milestoneCuesEnabled"
        />

        {/* No toggle: only the system can grant this, so the row reports and defers to app Settings. */}
        <ListSectionHeader title="Location" />
        <ListItem>
          <ListItem.HeadlineContent>
            <Text>Access</Text>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <Text>
              {location === 'granted'
                ? 'Location measures your distance and route, and keeps tracking while the screen is off.'
                : "Without location, runs are still timed correctly — but distance and pace aren't recorded."}
            </Text>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <Text>{location ? LOCATION_ACCESS[location] : '—'}</Text>
          </ListItem.TrailingContent>
        </ListItem>
        {location === 'denied' ? (
          <ListItem modifiers={[clickable(() => void Linking.openSettings())]}>
            <ListItem.HeadlineContent>
              <Text color={colors.primary}>Open Settings</Text>
            </ListItem.HeadlineContent>
          </ListItem>
        ) : null}
        {location === 'undetermined' ? (
          <ListItem modifiers={[clickable(() => void locationTracker.requestPermission())]}>
            <ListItem.HeadlineContent>
              <Text color={colors.primary}>Enable location</Text>
            </ListItem.HeadlineContent>
          </ListItem>
        ) : null}

        {/* No switch: Health Connect's revokeAllPermissions() only takes effect after an app
            restart, and Google's guidance sends users to Health Connect instead (ADR 0011). */}
        <ListSectionHeader title="Health Connect" />
        <ListItem>
          <ListItem.HeadlineContent>
            <Text>Access</Text>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <Text>
              {health === 'authorized'
                ? 'Finished runs are saved to Health Connect, with a route if location is on. Older runs can be saved one at a time from their summary.'
                : health === 'unavailable'
                  ? "Health Connect isn't available on this device."
                  : 'Save your finished runs to Health Connect, with distance and route. Nothing is ever read from Health Connect.'}
            </Text>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <Text>{HEALTH_ACCESS[health]}</Text>
          </ListItem.TrailingContent>
        </ListItem>
        {health === 'notDetermined' ? (
          <ListItem modifiers={[clickable(() => void requestWriteAccess())]}>
            <ListItem.HeadlineContent>
              <Text color={colors.primary}>Set up Health Connect</Text>
            </ListItem.HeadlineContent>
          </ListItem>
        ) : null}
        {health === 'denied' ? (
          <ListItem modifiers={[clickable(() => void openHealthApp())]}>
            <ListItem.HeadlineContent>
              <Text color={colors.primary}>Open Health Connect</Text>
            </ListItem.HeadlineContent>
          </ListItem>
        ) : null}
        <ListItem modifiers={[clickable(() => router.push('/privacy'))]}>
          <ListItem.HeadlineContent>
            <Text color={colors.primary}>Privacy policy</Text>
          </ListItem.HeadlineContent>
        </ListItem>

        <ListSectionHeader title="About" />
        <ListItem>
          <ListItem.HeadlineContent>
            <Text>Version</Text>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <Text>No account, no sign-in. Your runs stay on this device.</Text>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <Text>{Constants.expoConfig?.version ?? '—'}</Text>
          </ListItem.TrailingContent>
        </ListItem>

        {__DEV__ ? (
          <>
            <ListSectionHeader title="Developer" />
            <SettingsToggle label="Compressed plan" settingKey="useCompressedPlan" />
            <ListItem modifiers={[clickable(() => resetAndRestart(router))]}>
              <ListItem.HeadlineContent>
                <Text>Reset onboarding</Text>
              </ListItem.HeadlineContent>
            </ListItem>
          </>
        ) : null}

        {isFieldTestBuild() ? (
          <>
            <ListSectionHeader title="Field test" />
            <ListItem>
              <ListItem.SupportingContent>
                <Text>
                  Starts an untracked capture for the barometer field tests
                  (docs/field-test-capture-protocol.md). No cues, no plan progress, no Health
                  Connect write.
                </Text>
              </ListItem.SupportingContent>
            </ListItem>
            <FieldTestRow />
          </>
        ) : null}
      </LazyColumn>
    </Island>
  );
}
