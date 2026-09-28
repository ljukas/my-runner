import { Host, type HostProps } from '@expo/ui/swift-ui';

/**
 * The one spelling of the @expo/ui `Host` (ADR 0013) — the RN↔SwiftUI seam.
 * Fills its parent by default (`flex: 1`); pass `matchContents` for a
 * content-sized island, or an explicit `style` to override. All other Host
 * props (`useViewportSizeMeasurement`, etc.) pass straight through.
 */
export function IslandHost({ style, matchContents, ...props }: HostProps) {
  return (
    <Host
      matchContents={matchContents}
      style={style ?? (matchContents ? undefined : { flex: 1 })}
      {...props}
    />
  );
}
