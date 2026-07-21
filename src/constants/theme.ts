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
    backgroundGrouped: '#F2F2F7',
    backgroundCard: '#ffffff',
    textSecondary: '#60646C',
    primary: PRIMARY,
    primaryForeground: '#ffffff',
    primaryFill: '#0071E3',
    success: '#34C759',
    successForeground: '#ffffff',
    destructive: '#FF3B30',
    destructiveForeground: '#ffffff',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    backgroundGrouped: '#000000',
    backgroundCard: '#1C1C1E',
    textSecondary: '#B0B4BA',
    primary: '#5C9DFF',
    primaryForeground: '#ffffff',
    primaryFill: '#0071E3',
    success: '#30D158',
    successForeground: '#ffffff',
    destructive: '#FF453A',
    destructiveForeground: '#ffffff',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** Segment-kind accents — Apple iOS system colors (vibrant), per color scheme.
 * warmup=systemOrange, run=systemRed (Apple activity/Health red), walk=systemYellow,
 * cooldown=systemTeal. Shared by the SegmentBar, legend, run screen, and summary.
 * Access via the `useSegmentColors()` hook so it follows light/dark. */
export const SegmentColors: Record<'light' | 'dark', Record<SegmentKind, string>> = {
  light: {
    warmup: '#FF9500',
    run: '#007AFF',
    walk: '#8E8E93',
    cooldown: '#30B0C7',
  },
  dark: {
    warmup: '#FF9F0A',
    run: '#0A84FF',
    walk: '#8E8E93',
    cooldown: '#40CBE0',
  },
};

/** Run-summary stat-tile accents (ADR 0013) — chosen for the summary cards and
 * intentionally INDEPENDENT of the segment-bar palette (they need not match).
 * Apple iOS system colors, per color scheme. Access via `useStatColors()`. */
export const StatColors: Record<
  'light' | 'dark',
  { running: string; intervals: string; activeTime: string; longestRun: string }
> = {
  light: {
    running: '#FF3B30', // systemRed
    intervals: '#FF9500', // systemOrange
    activeTime: '#007AFF', // systemBlue
    longestRun: '#30B0C7', // systemTeal
  },
  dark: {
    running: '#FF453A',
    intervals: '#FF9F0A',
    activeTime: '#0A84FF',
    longestRun: '#40CBE0',
  },
};

/** Segment-kind SF Symbols for the run screen phase label. Warm-up/cool-down are
 * walking phases in the plan; only the run intervals get the running figure. */
export const SegmentSymbols: Record<SegmentKind, SFSymbol> = {
  warmup: 'figure.walk',
  run: 'figure.run',
  walk: 'figure.walk',
  cooldown: 'figure.cooldown',
};
