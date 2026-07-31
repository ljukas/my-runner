import type { StyleProp, ViewStyle } from 'react-native';

import type { BoundingBox, LatLng } from '@/domain/geo';

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
  /**
   * The drawn route's extent, in plain degrees — the adapter derives its own camera from this and
   * `aspectRatio`, so no library's zoom convention crosses the port (ADR 0010).
   */
  bbox: BoundingBox;
  /** Viewport width / height. Read once: the adapter fixes its camera on mount and never re-fits. */
  aspectRatio: number;
  interactive: boolean;
  /** Applied only when `interactive` is false; the viewer keeps MapKit's own elements instead. */
  accessibilityLabel?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}
