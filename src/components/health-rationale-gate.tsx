// Health Connect's permission-rationale intent exists only on Android (ADR 0025); iOS has no
// equivalent entry point, so there is nothing to mount.
export function HealthRationaleGate() {
  return null;
}
