import { AppleMaps } from 'expo-maps';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { ENDPOINT_MERGE_M, haversineMeters } from '@/domain/geo';
import { useTheme } from '@/hooks/use-theme';
import type { RouteMapProps } from './port';

/** Read-only styling: POIs off, no selection accessory, and every default-on control suppressed (spec §3). */
const PROPERTIES: AppleMaps.MapProperties = {
  selectionEnabled: false,
  pointsOfInterest: { including: [] },
  // AppleMapsMapStyleEmphasis isn't exported by expo-maps' public surface (namespace or top-level) — assert the literal.
  emphasis: 'MUTED' as AppleMaps.MapProperties['emphasis'],
  isMyLocationEnabled: false,
};

const UI_SETTINGS: AppleMaps.MapUISettings = {
  compassEnabled: false,
  myLocationButtonEnabled: false,
  scaleBarEnabled: false,
  togglePitchEnabled: false,
};

export function RouteMap({
  route,
  decorations,
  endpoints,
  camera,
  interactive,
  accessibilityLabel,
  onPress,
  style,
}: RouteMapProps) {
  const colors = useTheme();

  const polylines = useMemo(
    () =>
      [...route.lines, ...decorations].map((line) => ({
        id: line.id,
        coordinates: line.points.map((p) => ({ latitude: p.lat, longitude: p.lng })),
        color: line.color,
        width: line.width,
        contourStyle: AppleMaps.ContourStyle.STRAIGHT,
      })),
    [route, decorations],
  );

  const markers = useMemo(() => {
    if (!endpoints) return [];
    const merged = haversineMeters(endpoints.start, endpoints.finish) < ENDPOINT_MERGE_M;
    const start = {
      id: 'start',
      systemImage: 'figure.run',
      coordinates: { latitude: endpoints.start.lat, longitude: endpoints.start.lng },
      title: '',
      tintColor: colors.primary,
    };
    if (merged) return [start];
    return [
      start,
      {
        id: 'finish',
        systemImage: 'flag.checkered',
        coordinates: { latitude: endpoints.finish.lat, longitude: endpoints.finish.lng },
        title: '',
        tintColor: colors.success,
      },
    ];
  }, [endpoints, colors]);

  // why: AppleMaps.View's Swift host snaps its camera to any later cameraPosition prop change
  // (spec §4.3), so it must be frozen once via useState's initializer, not derived from props.
  const [latchedCamera] = useState(camera);

  const cameraPosition = useMemo(
    () => ({
      coordinates: { latitude: latchedCamera.center.lat, longitude: latchedCamera.center.lng },
      zoom: latchedCamera.zoom,
    }),
    [latchedCamera],
  );

  const map = (
    <AppleMaps.View
      style={{ flex: 1 }}
      // why: matches the default, but set explicitly — it's a View prop, not a `properties` field,
      // so omitting it reads as an oversight.
      colorScheme={AppleMaps.MapColorScheme.AUTOMATIC}
      cameraPosition={cameraPosition}
      polylines={polylines}
      markers={markers}
      properties={PROPERTIES}
      uiSettings={UI_SETTINGS}
    />
  );

  if (interactive) return <View style={style}>{map}</View>;

  // why: Apple exposes no interaction lock through expo-maps, so the preview is made inert RN-side —
  // pointerEvents 'none' makes the whole subtree unreachable to MapKit's gesture recognizers (spec §3).
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
