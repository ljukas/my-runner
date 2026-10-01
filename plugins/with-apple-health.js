const {
  createRunOncePlugin,
  withEntitlementsPlist,
  withInfoPlist,
} = require('expo/config-plugins');

// Write-only (ADR 0011 §2, §6): no NSHealthShareUsageDescription — an unused read purpose string is
// a false claim App Review can see in the binary.
/** @type {import('expo/config-plugins').ConfigPlugin<{ updateUsageDescription: string }>} */
function withAppleHealth(config, { updateUsageDescription } = {}) {
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
}

module.exports = createRunOncePlugin(withAppleHealth, 'with-apple-health');
