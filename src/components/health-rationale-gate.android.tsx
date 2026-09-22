import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { LaunchIntent } from '@/modules/launch-intent';

// The two intents Health Connect's permission dialog fires from its privacy-policy link — Android
// ≤ 13 and 14+ respectively — both aimed at MainActivity by the library's config plugin, with no
// URL for expo-router to route on (ADR 0011, Android amendment).
const RATIONALE_ACTIONS = new Set([
  'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE',
  'android.intent.action.VIEW_PERMISSION_USAGE',
]);

/** Opens the privacy policy when the app was started, or re-surfaced, for the Health Connect rationale. */
export function HealthRationaleGate() {
  const router = useRouter();
  useEffect(() => {
    const open = (action: string | null) => {
      if (action && RATIONALE_ACTIONS.has(action)) router.push('/privacy');
    };
    open(LaunchIntent.getAction());
    const subscription = LaunchIntent.addListener('onIntent', (event) => open(event.action));
    return () => subscription.remove();
  }, [router]);
  return null;
}
