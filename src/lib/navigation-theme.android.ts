import { DarkTheme, DefaultTheme } from 'expo-router';
import type { ColorSchemeName } from 'react-native';

import { materialTheme } from '@/constants/material-theme';

// why: the native stack header and tab headers paint the navigation theme's `card`, which would
// otherwise be React Navigation's white/black beside a Material `surface` screen (ADR 0025 §4).
export function navigationTheme(scheme: ColorSchemeName): typeof DefaultTheme {
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const m = materialTheme(scheme === 'dark' ? 'dark' : 'light');
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: m.primary,
      background: m.background,
      card: m.background,
      text: m.text,
      border: m.backgroundSelected,
    },
  };
}
