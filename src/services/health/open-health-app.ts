import * as Linking from 'expo-linking';

/**
 * why the fallback: HealthKit permissions live in the Health app, not in this app's own Settings
 * pane, and Apple publishes no public deep link to the per-app data-access page there. The
 * undocumented `x-apple-health://` scheme is confirmed working on-device — it opens Health.app at
 * its root — and is what ships; openSettings() stays as the safety net if that undocumented scheme
 * is ever rejected by Linking.openURL, since a working link to the app's root beats none.
 */
export async function openHealthApp(): Promise<void> {
  try {
    await Linking.openURL('x-apple-health://');
  } catch {
    await Linking.openSettings();
  }
}
