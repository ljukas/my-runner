// Registered here, not in a route: expo-router lazily requires routes, so only the
// entry module runs at bundle-eval — re-arming the location task on a headless
// relaunch before any route mounts (ADR 0008 §4).
import '@/services/location-tracker';

import 'expo-router/entry';
