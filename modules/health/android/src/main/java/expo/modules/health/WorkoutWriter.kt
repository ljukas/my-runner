package expo.modules.health

import android.content.Context
import android.os.Build
import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseRoute
import androidx.health.connect.client.records.ExerciseSegment
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.units.Length
import java.time.Instant
import kotlin.coroutines.cancellation.CancellationException
import java.time.ZoneId
import java.time.ZoneOffset
import kotlin.math.max
import kotlin.math.roundToLong

// Each is allowed inside a running session: RUNNING and WALKING by the running type's own set, REST
// and PAUSE by the universal one; Health Connect subtracts REST and PAUSE from the exercise time.
private val SEGMENT_TYPE = mapOf(
  SegmentKind.RUN to ExerciseSegment.EXERCISE_SEGMENT_TYPE_RUNNING,
  SegmentKind.WALK to ExerciseSegment.EXERCISE_SEGMENT_TYPE_WALKING,
  SegmentKind.REST to ExerciseSegment.EXERCISE_SEGMENT_TYPE_REST,
)

internal class WorkoutWriter(private val context: Context) {
  private val device = Device(type = Device.TYPE_PHONE, manufacturer = Build.MANUFACTURER, model = Build.MODEL)

  /** True when the session was saved without its segments because Health Connect refused them. */
  suspend fun save(workout: WorkoutRecord): Boolean {
    if (!(workout.startMs.isFinite() && workout.endMs.isFinite() && workout.startMs < workout.endMs)) {
      throw InvalidWorkoutException("its window is empty or not finite")
    }
    if (workout.syncIdentifier.isEmpty() || !workout.syncVersion.isFinite() || workout.syncVersion < 0) {
      throw InvalidWorkoutException("its sync identifier or version is unusable")
    }
    val version = workout.syncVersion.roundToLong()
    val client = HealthConnectClient.getOrCreate(context)
    val granted = client.permissionController.getGrantedPermissions()
    if (WritePermissions.exercise !in granted) throw NotAuthorizedException()
    val withDistance = WritePermissions.distance in granted
    val withRoute = WritePermissions.route in granted

    // why built inside the try: a record constructor's IllegalArgumentException then reaches the
    // fallback rather than escaping as a generic failure.
    fun records(structured: Boolean): List<Record> =
      listOf(session(workout, version, withRoute, structured)) +
        if (withDistance) workout.distances.mapNotNull { distance(it, version) } else emptyList()

    // Deleted before the insert, as on iOS: a failed insert costs an earlier save its distance
    // until the next one (ADR 0011's 2026-10-01 amendments).
    if (withDistance) deleteDistances(client, workout)
    return try {
      insert(client, records(structured = true))
      false
    } catch (refused: IllegalArgumentException) {
      if (workout.segments.isEmpty() && workout.pauses.isEmpty()) throw WorkoutRejectedException(refused)
      Log.w(TAG, "Health Connect refused the segments; saving the session without them", refused)
      // why the same version: insertRecords is atomic, so the refused attempt committed nothing.
      try {
        insert(client, records(structured = false))
      } catch (again: IllegalArgumentException) {
        throw WorkoutRejectedException(again)
      }
      true
    }
  }

  // why insertRecords once: it is atomic, so the session and its distance land together or not at
  // all, and a higher clientRecordVersion under the same clientRecordId replaces an earlier save.
  private suspend fun insert(client: HealthConnectClient, records: List<Record>) {
    try {
      client.insertRecords(records)
    } catch (error: SecurityException) {
      throw NotAuthorizedException(error)
    } catch (error: IllegalArgumentException) {
      throw error
    } catch (error: CancellationException) {
      throw error
    } catch (error: Exception) {
      throw WriteFailedException(error)
    }
  }

  // why delete first: the distance parts are keyed by index, so a re-save with fewer parts would
  // otherwise leave the extra ones counting towards the runner's totals. Health Connect deletes
  // only this app's own records; the millisecond past the end catches the part ending there.
  private suspend fun deleteDistances(client: HealthConnectClient, workout: WorkoutRecord) {
    try {
      client.deleteRecords(
        DistanceRecord::class,
        TimeRangeFilter.between(instant(workout.startMs), instant(workout.endMs + 1)),
      )
    } catch (error: Exception) {
      // why ignored: a stale part is a cosmetic leftover, never a reason to lose the save.
      Log.w(TAG, "Couldn't clear the earlier distance", error)
    }
  }

  private fun session(
    workout: WorkoutRecord,
    version: Long,
    withRoute: Boolean,
    structured: Boolean,
  ): ExerciseSessionRecord {
    val start = instant(workout.startMs)
    val end = instant(workout.endMs)
    return ExerciseSessionRecord(
      startTime = start,
      startZoneOffset = offset(start),
      endTime = end,
      endZoneOffset = offset(end),
      metadata = Metadata.activelyRecorded(device, workout.syncIdentifier, version),
      exerciseType = ExerciseSessionRecord.EXERCISE_TYPE_RUNNING,
      title = workout.title.ifBlank { null },
      segments = if (structured) segments(workout) else emptyList(),
      exerciseRoute = workout.route?.takeIf { withRoute }?.let { route(it, workout) },
    )
  }

  private fun segments(workout: WorkoutRecord): List<ExerciseSegment> =
    (
      workout.segments.map { segment(it.startMs, it.endMs, SEGMENT_TYPE.getValue(it.kind)) } +
        workout.pauses.map { segment(it.startMs, it.endMs, ExerciseSegment.EXERCISE_SEGMENT_TYPE_PAUSE) }
      ).sortedBy { it.startTime }

  private fun segment(startMs: Double, endMs: Double, type: Int) =
    ExerciseSegment(startTime = instant(startMs), endTime = instant(endMs), segmentType = type, repetitions = 0)

  // why the window and order checks, on whole milliseconds: the session constructor rejects a
  // point outside [start, end) or out of order, which would cost the whole save its segments.
  private fun route(route: RouteRecord, workout: WorkoutRecord): ExerciseRoute? {
    val start = millis(workout.startMs)
    val end = millis(workout.endMs)
    var last = Long.MIN_VALUE
    val points = route.points.filter { point ->
      val at = millis(point.timestampMs)
      (at in start until end && at > last).also { if (it) last = at }
    }
    if (points.isEmpty()) return null
    return ExerciseRoute(
      points.map { point ->
        ExerciseRoute.Location(
          time = instant(point.timestampMs),
          latitude = point.latitude,
          longitude = point.longitude,
          // why max(0): Health Connect rejects a negative accuracy, CoreLocation's "unknown".
          horizontalAccuracy = Length.meters(max(0.0, point.horizontalAccuracy)),
          // A negative vertical accuracy marks a fix without an altitude; 0 m would read as a
          // measured sea level.
          verticalAccuracy = point.verticalAccuracy.takeIf { it >= 0 }?.let(Length::meters),
          altitude = point.altitude.takeIf { point.verticalAccuracy >= 0 }?.let(Length::meters),
        )
      },
    )
  }

  private fun distance(part: DistancePartRecord, version: Long): DistanceRecord? {
    if (!(millis(part.startMs) < millis(part.endMs) && part.meters.isFinite() && part.meters > 0)) return null
    val start = instant(part.startMs)
    val end = instant(part.endMs)
    return DistanceRecord(
      startTime = start,
      startZoneOffset = offset(start),
      endTime = end,
      endZoneOffset = offset(end),
      distance = Length.meters(part.meters),
      metadata = Metadata.activelyRecorded(device, part.syncIdentifier, version),
    )
  }

  private fun millis(ms: Double): Long = ms.roundToLong()

  private fun instant(ms: Double): Instant = Instant.ofEpochMilli(millis(ms))

  private fun offset(at: Instant): ZoneOffset = ZoneId.systemDefault().rules.getOffset(at)

  private companion object {
    const val TAG = "Health"
  }
}
