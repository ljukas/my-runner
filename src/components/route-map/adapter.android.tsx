import { View } from 'react-native';

import type { RouteMapProps } from './port';

// Google Maps is a later Android stage (ADR 0025). The summary hides its map card before this is
// reached; the placeholder exists so `./adapter` resolves for the Android bundle (ADR 0003).
export function RouteMap({ style }: RouteMapProps) {
  return <View style={style} />;
}
