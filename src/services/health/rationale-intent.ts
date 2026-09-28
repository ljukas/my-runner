// Health Connect's permission-rationale intent exists only on Android (ADR 0011, 2026-09-22
// amendment); iOS has no equivalent entry point, so nothing ever fires.
export function subscribeHealthRationaleIntent(_listener: () => void): () => void {
  return () => {};
}
