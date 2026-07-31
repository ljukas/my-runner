export type { RouteMapLine, RouteMapProps, RouteMapRoute } from './port';
// No composition wrapper: a route map has no cross-platform gating seam (cf. location-tracker).
export { RouteMap } from './adapter';
