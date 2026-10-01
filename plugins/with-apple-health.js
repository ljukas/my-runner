const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

/**
 * The HealthKit entitlement and the update purpose string for `modules/apple-health/`. Write-only
 * (ADR 0011 §2, §6): it never sets NSHealthShareUsageDescription, because a read purpose string
 * the app never uses is a false claim App Review can see in the binary.
 */
module.exports = function withAppleHealth(config, { updateUsageDescription }) {
  if (!updateUsageDescription) {
    throw new Error('with-apple-health: `updateUsageDescription` is required');
  }
  config = withEntitlementsPlist(config, (cfg) => {
    cfg.modResults['com.apple.developer.healthkit'] = true;
    return cfg;
  });
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.NSHealthUpdateUsageDescription = updateUsageDescription;
    return cfg;
  });
};
