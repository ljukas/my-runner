import ExpoModulesCore

// Mirrors `HealthWorkout` in ../types.ts; times are epoch ms. `title` is left out: HealthKit has no
// field Health shows.

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
  @Field(.required) var startMs: Double = 0
  @Field(.required) var endMs: Double = 0
  @Field(.required) var meters: Double = 0
  @Field(.required) var syncIdentifier: String = ""
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
  @Field(.required) var syncIdentifier: String = ""
  @Field var points: [RoutePointRecord] = []
}

// why required: a dropped key would otherwise default to "" and every run would replace the last.
struct WorkoutRecord: Record {
  @Field(.required) var startMs: Double = 0
  @Field(.required) var endMs: Double = 0
  @Field(.required) var syncIdentifier: String = ""
  @Field(.required) var syncVersion: Double = 0
  @Field var distances: [DistanceRecord] = []
  @Field var pauses: [WindowRecord] = []
  @Field var segments: [SegmentRecord] = []
  @Field var route: RouteRecord?
}

struct SaveResultRecord: Record {
  @Field var plain: Bool = false
}
