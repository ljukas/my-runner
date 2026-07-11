/**
 * JS mirror of the app theme. The main styling mechanism is Uniwind
 * (Tailwind classes via `className`); the theme tokens live in src/global.css.
 * `Colors` below mirrors those tokens for the places that need color values
 * in JS (`useTheme`, @expo/ui SwiftUI islands) — keep both in sync.
 */

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    primary: '#3c87f7',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    primary: '#3c87f7',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
