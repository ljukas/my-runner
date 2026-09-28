// Keeps release version bumps out of the native fingerprint so OTA-eligible
// releases don't force a new store build. Only `expo.version` (and, if they
// ever appear, buildNumber/versionCode) are excluded — native-affecting
// changes (plugins, native deps, icons, permissions) still change the
// fingerprint and force a build, as they must.
// See ADR 0012 and https://github.com/expo/expo-github-action/issues/286.
const { SourceSkips } = require('expo/fingerprint');

/** @type {import('expo/fingerprint').Config} */
const config = {
  // Setting sourceSkips REPLACES @expo/fingerprint's DEFAULT_SOURCE_SKIPS
  // (PackageJsonAndroidAndIosScriptsIfNotContainRun) instead of merging, so
  // that default must be re-added explicitly. Without it, prebuild on the EAS
  // worker rewrites the android/ios package.json scripts and the build fails
  // the expo-updates runtime-version (fingerprint) consistency check.
  sourceSkips:
    SourceSkips.ExpoConfigVersions |
    SourceSkips.ExpoConfigRuntimeVersionIfString |
    SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun,
  // A local Gradle build (AGP 8's namespace migration) deletes the legacy `package="…"` attribute
  // from any dependency manifest that still carries one, inside node_modules — and the whole
  // package directory is an iOS fingerprint source, so `eas build --local -p ios` after
  // `bun run android` fails its runtime-version check (ADR 0025 item 8; measured: only
  // @react-native-masked-view/masked-view). The attribute is dead under AGP 8 — the namespace comes
  // from build.gradle — so hashing manifests without it loses nothing and makes the pristine and
  // the Gradle-touched tree hash the same. Chunks are joined first so the attribute cannot straddle
  // a chunk boundary (the reader streams 1 KiB at a time).
  fileHookTransform: (source, chunk, isEndOfFile) => {
    if (source.type !== 'file' || !source.filePath.endsWith('AndroidManifest.xml')) return chunk;
    const buffered = manifestChunks.get(source.filePath) ?? [];
    if (chunk != null) buffered.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk);
    if (!isEndOfFile) {
      manifestChunks.set(source.filePath, buffered);
      return null;
    }
    manifestChunks.delete(source.filePath);
    // XML whitespace is insignificant, and AGP leaves a double space where the attribute was.
    return buffered
      .join('')
      .replace(/\s+package="[^"]*"/, '')
      .replace(/\s+/g, ' ');
  },
};

const manifestChunks = new Map();

module.exports = config;
