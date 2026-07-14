/**
 * JS mirror of the app theme. The main styling mechanism is Uniwind
 * (Tailwind classes via `className`); the theme tokens live in src/global.css.
 * `Colors` below mirrors those tokens for the places that need color values
 * in JS (`useTheme`, @expo/ui SwiftUI islands) — keep both in sync.
 */

import type { SFSymbol } from 'sf-symbols-typescript';

import type { SegmentKind } from '@/domain/plan';

const PRIMARY = '#3c87f7';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    primary: PRIMARY,
    primaryForeground: '#ffffff',
    destructive: '#FF3B30',
    destructiveForeground: '#ffffff',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    primary: PRIMARY,
    primaryForeground: '#ffffff',
    destructive: '#FF453A',
    destructiveForeground: '#ffffff',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** Segment-kind accents (Beacon palette), shared by the SegmentBar, legend, and run screen. */
export const SegmentColors: Record<SegmentKind, string> = {
  warmup: '#FF7A00',
  run: PRIMARY,
  walk: '#FFC400',
  cooldown: '#00B39A',
};

/** Segment-kind SF Symbols for the run screen phase label. Warm-up/cool-down are
 * walking phases in the plan; only the run intervals get the running figure. */
export const SegmentSymbols: Record<SegmentKind, SFSymbol> = {
  warmup: 'figure.walk',
  run: 'figure.run',
  walk: 'figure.walk',
  cooldown: 'figure.cooldown',
};
