import { Uniwind } from 'uniwind';

import { materialTheme, type Scheme } from '@/constants/material-theme';

/** Material palette → Uniwind CSS variables (ADR 0025 §4). Call once at module scope, before the first frame. */
export function applyPlatformTheme(): void {
  for (const scheme of ['light', 'dark'] as const satisfies readonly Scheme[]) {
    const c = materialTheme(scheme);
    Uniwind.updateCSSVariables(scheme, {
      '--color-primary': c.primary,
      '--color-primary-foreground': c.primaryForeground,
      '--color-primary-fill': c.primaryFill,
      '--color-background': c.background,
      '--color-background-element': c.backgroundElement,
      '--color-background-selected': c.backgroundSelected,
      '--color-background-grouped': c.backgroundGrouped,
      '--color-background-card': c.backgroundCard,
      '--color-foreground': c.text,
      '--color-foreground-secondary': c.textSecondary,
      '--color-destructive': c.destructive,
      '--color-destructive-foreground': c.destructiveForeground,
    });
  }
}
