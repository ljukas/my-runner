import * as Linking from 'expo-linking';
import { openHealthConnectSettings } from 'react-native-health-connect';

export async function openHealthApp(): Promise<void> {
  try {
    openHealthConnectSettings();
  } catch {
    // why the fallback: the library throws when no activity handles ACTION_HEALTH_CONNECT_SETTINGS.
    try {
      await Linking.openSettings();
    } catch (error) {
      console.warn('[health] openHealthApp fallback failed', error);
    }
  }
}
