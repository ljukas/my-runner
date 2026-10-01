import ExpoModulesCore

// Mirrors `HealthKitWorkout` in ../types.ts; times are epoch ms.

struct WindowRecord: Record {
  @Field var startMs: Double = 0
  @Field var endMs: Double = 0
}

enum SegmentKind: String, Enumerable {
  case run
  case walk
  case rest
}

struct SegmentRecord: Record {
  @Field var startMs: Double = 0
  @Field var endMs: Double = 0
  @Field var kind: SegmentKind = .run
}

struct DistanceRecord: Record {
  @Field var startMs: Double = 0
  @Field var endMs: Double = 0
  @Field var meters: Double = 0
  @Field var syncIdentifier: String = ""
}

struct RoutePointRecord: Record {
  @Field var latitude: Double = 0
  @Field var longitude: Double = 0
  @Field var timestampMs: Double = 0
  @Field var altitude: Double = 0
  @Field var course: Double = -1
  @Field var speed: Double = -1
  @Field var horizontalAccuracy: Double = -1
  @Field var verticalAccuracy: Double = -1
}

struct RouteRecord: Record {
  @Field var syncIdentifier: String = ""
  @Field var points: [RoutePointRecord] = []
}

struct WorkoutRecord: Record {
  @Field var startMs: Double = 0
  @Field var endMs: Double = 0
  @Field var syncIdentifier: String = ""
  @Field var syncVersion: Double = 0
  @Field var distances: [DistanceRecord] = []
  @Field var pauses: [WindowRecord] = []
  @Field var segments: [SegmentRecord] = []
  @Field var route: RouteRecord?
}

struct SaveResultRecord: Record {
  @Field var plain: Bool = false
}
