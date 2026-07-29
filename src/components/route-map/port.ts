import type { StyleProp, ViewStyle } from 'react-native';

import type { CameraFit, LatLng } from '@/domain/geo';

export interface RouteMapLine {
  /** Deterministic — expo-maps' polyline record is Identifiable with a UUID default (spec §3). */
  id: string;
  points: LatLng[];
  color: string;
  width: number;
}

export interface RouteMapRoute {
  lines: RouteMapLine[];
}

export interface RouteMapProps {
  route: RouteMapRoute;
  endpoints: { start: LatLng; finish: LatLng } | null;
  camera: CameraFit;
  interactive: boolean;
  /** Applied only when `interactive` is false; the viewer keeps MapKit's own elements instead. */
  accessibilityLabel?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}
