import * as Linking from 'expo-linking';
import { openHealthConnectSettings } from 'react-native-health-connect';

/**
 * Health Connect's own settings (`ACTION_HEALTH_CONNECT_SETTINGS`), where the user manages this
 * app's grants; the app's own Settings pane is the fallback if that intent has no handler.
 */
export async function openHealthApp(): Promise<void> {
  try {
    openHealthConnectSettings();
  } catch {
    try {
      await Linking.openSettings();
    } catch (error) {
      console.warn('[health] openHealthApp fallback failed', error);
    }
  }
}
