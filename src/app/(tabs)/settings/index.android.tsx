import { LazyColumn, ListItem, Text } from '@expo/ui/jetpack-compose';
import { background, clickable, fillMaxSize } from '@expo/ui/jetpack-compose/modifiers';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';

import { Island } from '@/components/island';
import { ListSectionHeader } from '@/components/list-section-header';
import { SettingsToggle } from '@/components/settings-toggle';
import { useTheme } from '@/hooks/use-theme';
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

// Health and the field-test capture are iOS-only until their Android stages land (ADR 0025); the
// rows are absent rather than "not available".
export default function SettingsScreen() {
  const router = useRouter();
  const colors = useTheme();
  const location = useLocationPermission();

  return (
    <Island>
      <LazyColumn
        modifiers={[fillMaxSize(), background(colors.background)]}
        contentPadding={{ bottom: 24 }}
      >
        <ListSectionHeader title="Vibration cues" />
        <SettingsToggle
          label="Interval cues"
          description="A vibration at every walk/run switch."
          settingKey="intervalCuesEnabled"
        />
        <SettingsToggle
          label="Milestone cues"
          description="Halfway, your last run, and finishing. Cues need the screen on — lock the run screen to keep it awake."
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
      </LazyColumn>
    </Island>
  );
}
