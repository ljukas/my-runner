import { LazyColumn, ListItem, Text } from '@expo/ui/jetpack-compose';
import { background, clickable, fillMaxSize } from '@expo/ui/jetpack-compose/modifiers';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

import { Island } from '@/components/island';
import { ListSectionHeader } from '@/components/list-section-header';
import { SettingsToggle } from '@/components/settings-toggle';
import { useTheme } from '@/hooks/use-theme';
import { resetAndRestart } from '@/services/onboarding-store';

// Location, Apple Health and the field-test capture are iOS-only until their Android stages land
// (ADR 0025); the rows are absent rather than "not available".
export default function SettingsScreen() {
  const router = useRouter();
  const colors = useTheme();

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
          description="Halfway, your last run, and finishing. Cues need the screen on — the run screen keeps it awake."
          settingKey="milestoneCuesEnabled"
        />

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
