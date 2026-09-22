import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { LaunchIntent } from '@/modules/launch-intent';
import { isHealthRationaleAction } from '@/services/health';

/**
 * Opens the privacy policy when the app was started, or re-surfaced, by Health Connect's
 * permission-rationale intent — which carries no URL for expo-router to route on (ADR 0011,
 * Android amendment).
 */
export function HealthRationaleGate() {
  const router = useRouter();
  useEffect(() => {
    const open = (action: string | null) => {
      if (isHealthRationaleAction(action)) router.push('/privacy');
    };
    open(LaunchIntent.getAction());
    const subscription = LaunchIntent.addListener('onIntent', (event) => open(event.action));
    return () => subscription.remove();
  }, [router]);
  return null;
}
