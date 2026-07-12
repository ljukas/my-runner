// Keeps release version bumps out of the native fingerprint so OTA-eligible
// releases don't force a new store build. Only `expo.version` (and, if they
// ever appear, buildNumber/versionCode) are excluded — native-affecting
// changes (plugins, native deps, icons, permissions) still change the
// fingerprint and force a build, as they must.
// See ADR 0012 and https://github.com/expo/expo-github-action/issues/286.
const { SourceSkips } = require('expo/fingerprint');

/** @type {import('expo/fingerprint').Config} */
const config = {
  sourceSkips:
    SourceSkips.ExpoConfigVersions | SourceSkips.ExpoConfigRuntimeVersionIfString,
};

module.exports = config;
