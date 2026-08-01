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
    delete cfg.modResults.NSHealthShareUsageDescription;
    return cfg;
  });
};
