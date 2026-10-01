const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withEntitlementsPlist,
  withInfoPlist,
} = require('expo/config-plugins');

const RATIONALE_ACTION = 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE';
const PERMISSION_USAGE_ALIAS = 'ViewPermissionUsageActivity';

// Write-only (ADR 0011 §2, §6): no NSHealthShareUsageDescription — an unused read purpose string is
// a false claim App Review can see in the binary.
function withAppleHealth(config, updateUsageDescription) {
  config = withEntitlementsPlist(config, (cfg) => {
    cfg.modResults['com.apple.developer.healthkit'] = true;
    return cfg;
  });
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.NSHealthUpdateUsageDescription = updateUsageDescription;
    return cfg;
  });
}

// Health Connect's permission dialog links to the app's privacy policy through MainActivity: by
// the rationale action on Android 13 and below, and by this alias from Android 14. The module
// itself declares the permissions; these entries have to name the app's own activity.
function withHealthConnect(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);

    const filters = (activity['intent-filter'] ??= []);
    if (!filters.some((f) => f.action?.some((a) => a.$['android:name'] === RATIONALE_ACTION))) {
      filters.push({ action: [{ $: { 'android:name': RATIONALE_ACTION } }] });
    }

    const aliases = (application['activity-alias'] ??= []);
    if (!aliases.some((a) => a.$['android:name'] === PERMISSION_USAGE_ALIAS)) {
      aliases.push({
        $: {
          'android:name': PERMISSION_USAGE_ALIAS,
          'android:exported': 'true',
          'android:targetActivity': activity.$['android:name'],
          'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.intent.action.VIEW_PERMISSION_USAGE' } }],
            category: [{ $: { 'android:name': 'android.intent.category.HEALTH_PERMISSIONS' } }],
          },
        ],
      });
    }
    return cfg;
  });
}

/** @type {import('expo/config-plugins').ConfigPlugin<{ updateUsageDescription: string }>} */
function withHealth(config, { updateUsageDescription } = {}) {
  if (!updateUsageDescription) {
    throw new Error('with-health: `updateUsageDescription` is required');
  }
  return withHealthConnect(withAppleHealth(config, updateUsageDescription));
}

module.exports = createRunOncePlugin(withHealth, 'with-health');
