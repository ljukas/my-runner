import { LaunchIntent } from '@/modules/launch-intent';
import { isHealthRationaleAction } from './health-connect';

/**
 * Calls `listener` when the app was started by, or is re-surfaced by, Health Connect's
 * permission-rationale intent — immediately if the launch intent was one, then on every later
 * one. The intent carries no URL, so React Native's Linking never sees it.
 */
export function subscribeHealthRationaleIntent(listener: () => void): () => void {
  if (isHealthRationaleAction(LaunchIntent.getAction())) listener();
  const subscription = LaunchIntent.addListener('onIntent', ({ action }) => {
    if (isHealthRationaleAction(action)) listener();
  });
  return () => subscription.remove();
}
