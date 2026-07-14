import { IslandButton } from './button';
import { IslandHost } from './host';
import { IslandLabel } from './label';
import { IslandText } from './text';

/**
 * The @expo/ui SwiftUI seam (ADR 0013): one `Island` — the `Host` wrapper —
 * with `.Text`, `.Label`, and `.Button` naming the repeated idioms so screens
 * stop hand-plumbing `useTheme()` into modifier arrays. The Android fork edits
 * these modules, not the screens (ADR 0005 §4).
 */
export const Island = Object.assign(IslandHost, {
  Text: IslandText,
  Label: IslandLabel,
  Button: IslandButton,
});
