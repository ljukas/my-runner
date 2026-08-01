import * as Linking from 'expo-linking';

/**
 * why the fallback: HealthKit permissions live in the Health app, not in this app's own Settings
 * pane, and Apple publishes no public deep link to the per-app data-access page there. The
 * undocumented `x-apple-health://` scheme is tried first because it lands closer to that page;
 * openSettings() is the public API that always resolves, if only to this app's own Settings entry.
 * Which destination actually lands on-device is still an open question a separate task resolves.
 */
export async function openHealthApp(): Promise<void> {
  try {
    await Linking.openURL('x-apple-health://');
  } catch {
    await Linking.openSettings();
  }
}
