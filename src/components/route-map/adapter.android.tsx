import { GoogleMaps } from 'expo-maps';
import { useMemo, useState } from 'react';
import { type LayoutChangeEvent, PixelRatio, Pressable, useColorScheme, View } from 'react-native';

import {
  ENDPOINT_MERGE_M,
  endpointRadiusM,
  googleCameraForBoundingBox,
  haversineMeters,
  type LatLng,
} from '@/domain/geo';
import { useTheme } from '@/hooks/use-theme';
import type { RouteMapProps } from './port';

// why isBuildingEnabled off: 3D blocks hide the route at street zoom (spec §3).
const PROPERTIES: GoogleMaps.MapProperties = {
  selectionEnabled: false,
  isBuildingEnabled: false,
  isMyLocationEnabled: false,
  isTrafficEnabled: false,
  mapType: GoogleMaps.MapType.NORMAL,
};

const UI_SETTINGS: GoogleMaps.MapUISettings = {
  compassEnabled: false,
  indoorLevelPickerEnabled: false,
  mapToolbarEnabled: false,
  myLocationButtonEnabled: false,
  scaleBarEnabled: false,
  togglePitchEnabled: false,
  zoomControlsEnabled: false,
};

// why: Google exposes a real gesture lock (ADR 0010 amendment 6); the Pressable below still owns
// the press and the a11y role, so this is belt-and-braces against a gesture reaching the map.
const INERT_UI_SETTINGS: GoogleMaps.MapUISettings = {
  ...UI_SETTINGS,
  rotationGesturesEnabled: false,
  scrollGesturesEnabled: false,
  scrollGesturesEnabledDuringRotateOrZoom: false,
  tiltGesturesEnabled: false,
  zoomGesturesEnabled: false,
};

const ENDPOINT_RING_DP = 2;

type CameraPosition = NonNullable<GoogleMaps.MapProps['cameraPosition']>;

export function RouteMap({
  route,
  endpoints,
  bbox,
  interactive,
  accessibilityLabel,
  onPress,
  style,
}: RouteMapProps) {
  const colors = useTheme();
  // why explicit, not FOLLOW_SYSTEM: the SDK reads FOLLOW_SYSTEM once at map creation, so a theme
  // switch while the summary is open left light tiles under dark endpoint rings (measured).
  const colorScheme =
    useColorScheme() === 'dark' ? GoogleMaps.MapColorScheme.DARK : GoogleMaps.MapColorScheme.LIGHT;
  // why: pixels, not dp — GoogleMapsView.kt hands `width` straight to Compose's Polyline, so the
  // run/walk stroke widths would come out ~3× too thin on a 3× device without this.
  const pixelRatio = PixelRatio.get();

  const polylines = useMemo(
    () =>
      route.lines.map((line) => ({
        id: line.id,
        coordinates: line.points.map((p) => ({ latitude: p.lat, longitude: p.lng })),
        color: line.color,
        width: line.width * pixelRatio,
      })),
    [route, pixelRatio],
  );

  // why circles, not markers: GoogleMapsMarker cannot be tinted or given a symbol without a
  // SharedRef image from expo-image, a native dependency on both platforms (ADR 0010 Android amendment).
  const circles = useMemo(() => {
    if (!endpoints) return [];
    const radius = endpointRadiusM(bbox);
    const dot = (id: string, at: LatLng, color: string) => ({
      id,
      center: { latitude: at.lat, longitude: at.lng },
      radius,
      color,
      lineColor: colors.background,
      lineWidth: ENDPOINT_RING_DP * pixelRatio,
    });
    const start = dot('start', endpoints.start, colors.primary);
    if (haversineMeters(endpoints.start, endpoints.finish) < ENDPOINT_MERGE_M) return [start];
    return [start, dot('finish', endpoints.finish, colors.success)];
  }, [endpoints, bbox, colors, pixelRatio]);

  // why measured here: Google zoom is pixel-based; the port carries only an aspect ratio (ADR 0010
  // amendment 8).
  // why frozen: GoogleMapsView.kt re-creates its camera state on every cameraPosition change, so the
  // fit is taken once from the first non-zero layout — a later re-fit would yank a panned view. The
  // map mounts only after that layout, so its first camera is already the fit and nothing snaps.
  const [cameraPosition, setCameraPosition] = useState<CameraPosition | null>(null);
  const onLayout = (event: LayoutChangeEvent) => {
    if (cameraPosition) return;
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    const fit = googleCameraForBoundingBox(bbox, { widthDp: width, heightDp: height });
    setCameraPosition({
      coordinates: { latitude: fit.center.lat, longitude: fit.center.lng },
      zoom: fit.zoom,
    });
  };

  const map = (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      {cameraPosition ? (
        <GoogleMaps.View
          style={{ flex: 1 }}
          colorScheme={colorScheme}
          cameraPosition={cameraPosition}
          polylines={polylines}
          circles={circles}
          properties={PROPERTIES}
          uiSettings={interactive ? UI_SETTINGS : INERT_UI_SETTINGS}
        />
      ) : null}
    </View>
  );

  if (interactive) return <View style={style}>{map}</View>;

  return (
    <Pressable
      // why: the only press feedback available — the map itself cannot highlight (spec §7.2).
      style={(state) => [style, state.pressed && { opacity: 0.85 }]}
      onPress={onPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens the full-screen route"
    >
      <View style={{ flex: 1 }} pointerEvents="none">
        {map}
      </View>
    </Pressable>
  );
}
