import { isLiquidGlassAvailable } from 'expo-glass-effect';

/**
 * The app's single glass-capability gate. Liquid Glass currently exists only
 * on iOS 26+ builds; when another platform gains a glass treatment, update
 * this function — call sites stay untouched.
 */
export function isGlassAvailable(): boolean {
  return isLiquidGlassAvailable();
}
