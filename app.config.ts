import { ConfigContext, ExpoConfig } from 'expo/config';

// Selects the app identity from APP_VARIANT so the development and e2e builds
// install side-by-side (distinct bundle id + name + scheme). Unset (production /
// preview) keeps the clean identity. See ADR 0019.
export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = process.env.APP_VARIANT; // 'development' | 'e2e' | undefined

  const idSuffix = variant === 'development' ? '.dev' : variant === 'e2e' ? '.e2e' : '';
  const schemeSuffix = variant === 'development' ? 'dev' : variant === 'e2e' ? 'e2e' : '';

  return {
    ...config,
    slug: config?.slug ?? 'runbro',
    name: `${config.name}${idSuffix}`,
    scheme: `${config.scheme}${schemeSuffix}`,
    // The exp+<slug> dev-launcher scheme is slug-derived, so it is shared across
    // variants. Register it only on the dev build so exp+runbro unambiguously
    // opens the dev client when dev + e2e coexist (ADR 0019).
    plugins: [
      ...(config.plugins ?? []),
      ['expo-dev-client', { addGeneratedScheme: variant === 'development' }],
    ] as ExpoConfig['plugins'],
    ios: {
      ...config.ios,
      bundleIdentifier: `${config.ios?.bundleIdentifier ?? ''}${idSuffix}`,
    },
    android: {
      ...config.android,
      package: `${config.android?.package ?? ''}${idSuffix}`,
      // why: a build-time credential kept out of version control (ADR 0010 item 5) — baked into
      // the manifest at prebuild, never read by JS. why a placeholder: the Maps SDK throws
      // `API key not found` and crashes the app when the meta-data is absent (measured), whereas
      // an invalid key only logs `Authorization failure` and shows grey tiles.
      config: {
        ...config.android?.config,
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? 'MISSING_GOOGLE_MAPS_ANDROID_API_KEY',
        },
      },
    },
  };
};
