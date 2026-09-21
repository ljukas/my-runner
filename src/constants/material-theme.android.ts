import { getMaterialColors } from '@expo/ui/jetpack-compose';

import { Colors, type ThemeColor } from './theme';

export type Scheme = 'light' | 'dark';

const cache = new Map<Scheme, Record<ThemeColor, string>>();

/**
 * The app's colour tokens filled from the device's Material 3 palette — wallpaper-derived on
 * Android 12+ (ADR 0025). Cached per scheme: the palette only changes with a wallpaper change,
 * which lands on the next launch. `success` has no Material role and keeps the shared value.
 */
export function materialTheme(scheme: Scheme): Record<ThemeColor, string> {
  const cached = cache.get(scheme);
  if (cached) return cached;
  const m = getMaterialColors({ scheme });
  const theme: Record<ThemeColor, string> = {
    text: m.onSurface,
    background: m.surface,
    // Filled cards sit two tonal steps above the page, or they read as the same surface.
    backgroundElement: m.surfaceContainerHigh,
    backgroundSelected: m.surfaceContainerHighest,
    backgroundGrouped: m.surface,
    backgroundCard: m.surfaceContainerHighest,
    textSecondary: m.onSurfaceVariant,
    primary: m.primary,
    primaryForeground: m.onPrimary,
    primaryFill: m.primary,
    success: Colors[scheme].success,
    successForeground: Colors[scheme].successForeground,
    destructive: m.error,
    destructiveForeground: m.onError,
  };
  cache.set(scheme, theme);
  return theme;
}
