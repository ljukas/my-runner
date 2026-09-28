import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { subscribeHealthRationaleIntent } from '@/services/health';

/** Opens the privacy policy when the platform health store asks the app to show its rationale. */
export function HealthRationaleGate() {
  const router = useRouter();
  useEffect(() => subscribeHealthRationaleIntent(() => router.push('/privacy')), [router]);
  return null;
}
