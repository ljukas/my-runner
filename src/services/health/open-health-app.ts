import * as Linking from 'expo-linking';

/**
 * why the fallback: HealthKit permissions live in the Health app, not in the app's own Settings
 * pane, and Apple publishes no deep link to the per-app data-access page. The undocumented scheme
 * is tried first because it lands closer; openSettings() is the public API that always resolves.
 * Which one actually lands is resolved on the simulator — see the plan's Task 11.
 */
export async function openHealthApp(): Promise<void> {
  try {
    await Linking.openURL('x-apple-health://');
  } catch {
    await Linking.openSettings();
  }
}
