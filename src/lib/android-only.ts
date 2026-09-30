import { Platform } from 'react-native';

/**
 * `className` on Android, nothing on iOS. why not Uniwind's `android:` variant: 1.12 compiles some
 * of them (the `pb-*` insets) into the iOS bundle too (ADR 0002's 2026-09-30 amendment).
 */
export function androidOnly(className: string): string | undefined {
  return Platform.OS === 'android' ? className : undefined;
}
