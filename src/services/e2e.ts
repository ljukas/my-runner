/**
 * Build-time E2E signal, set ONLY by the eas.json `e2e-simulator` profile
 * (`env.EXPO_PUBLIC_E2E=1`, inlined into the bundle by Metro at build time).
 * Read at call time and free of `__DEV__`, so pure-TS `bun test` importers stay
 * runtime-clean.
 */
export function isE2EBuild(): boolean {
  return process.env.EXPO_PUBLIC_E2E === '1';
}

/**
 * Whether the compressed dev/E2E plan is reachable in this build: dev builds or
 * the E2E build only, never production. `__DEV__` is referenced only inside this
 * function body (see the `bun test` constraint).
 */
export function compressedPlanReachable(): boolean {
  return __DEV__ || isE2EBuild();
}
