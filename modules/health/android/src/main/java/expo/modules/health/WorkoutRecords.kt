package expo.modules.health

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.records.Required
import expo.modules.kotlin.types.Enumerable

// Mirrors `HealthWorkout` in ../types.ts (and WorkoutRecords.swift); times are epoch ms. A route
// point's course and speed have no Health Connect field, so they are not read.

class WindowRecord : Record {
  @Field val startMs: Double = 0.0
  @Field val endMs: Double = 0.0
}

enum class SegmentKind(val value: String) : Enumerable {
  RUN("run"),
  WALK("walk"),
  REST("rest"),
}

class SegmentRecord : Record {
  @Field val startMs: Double = 0.0
  @Field val endMs: Double = 0.0
  @Field val kind: SegmentKind = SegmentKind.RUN
}

class DistancePartRecord : Record {
  @Field @Required val startMs: Double = 0.0
  @Field @Required val endMs: Double = 0.0
  @Field @Required val meters: Double = 0.0
  @Field @Required val syncIdentifier: String = ""
}

class RoutePointRecord : Record {
  @Field val latitude: Double = 0.0
  @Field val longitude: Double = 0.0
  @Field val timestampMs: Double = 0.0
  @Field val altitude: Double = 0.0
  @Field val horizontalAccuracy: Double = -1.0
  @Field val verticalAccuracy: Double = -1.0
}

class RouteRecord : Record {
  @Field val points: List<RoutePointRecord> = emptyList()
}

// why required: a dropped key would otherwise default to "" and every run would replace the last.
class WorkoutRecord : Record {
  @Field @Required val startMs: Double = 0.0
  @Field @Required val endMs: Double = 0.0
  @Field @Required val syncIdentifier: String = ""
  @Field @Required val syncVersion: Double = 0.0
  @Field val title: String = ""
  @Field val distances: List<DistancePartRecord> = emptyList()
  @Field val pauses: List<WindowRecord> = emptyList()
  @Field val segments: List<SegmentRecord> = emptyList()
  @Field val route: RouteRecord? = null
}
