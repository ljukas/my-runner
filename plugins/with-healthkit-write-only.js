const { withInfoPlist } = require('expo/config-plugins');

/**
 * why: the HealthKit plugin writes NSHealthShareUsageDescription unconditionally and offers no way
 * to opt out, so a write-only app would ship a read-access purpose string it never uses — a false
 * claim in the binary, and an App Review question with no good answer (ADR 0011 §2, §6).
 * Must be listed BEFORE the HealthKit plugin in app.json: @expo/config-plugins mod chaining runs
 * each plugin's own action before delegating to the previously-registered plugin's mod, so the
 * plugin registered earlier in the array is the one whose effect survives last.
 */
module.exports = function withHealthKitWriteOnly(config) {
  return withInfoPlist(config, (cfg) => {
    // A reversed plugin order (this plugin listed after the HealthKit plugin in app.json) makes
    // this a silent no-op instead of stripping the key — throw loudly instead of shipping a false
    // "wants to read your health data" purpose string App Review can see in the binary.
    if (cfg.modResults.NSHealthShareUsageDescription === undefined) {
      throw new Error(
        'with-healthkit-write-only: NSHealthShareUsageDescription was not present to strip. ' +
          'This plugin must be listed BEFORE @kingstinct/react-native-healthkit in app.json\'s ' +
          '"plugins" array — mods chain in registration order, so an earlier entry runs its own ' +
          'action after the later ones, meaning the HealthKit plugin must write the key first.',
      );
    }
    delete cfg.modResults.NSHealthShareUsageDescription;
    return cfg;
  });
};
