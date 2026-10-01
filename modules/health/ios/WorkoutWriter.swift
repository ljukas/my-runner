import CoreLocation
import HealthKit
import UIKit

// Apple's guidance for interval workouts: every activity takes the workout's own type, labelled
// with custom metadata. Nothing in Health or Fitness reads this key; it keeps the kind on record.
private let segmentKindKey = "RunBroSegmentKind"

private struct StructureRefused: Error {}

enum WorkoutWriter {
  static let store = HKHealthStore()

  /// True when the workout was saved without its pauses and segments because HealthKit refused them.
  /// Writes at once, locked or not: HealthKit holds a locked device's writes and merges them at
  /// unlock (protecting-user-privacy), and the route commits with the workout.
  static func save(_ workout: WorkoutRecord) async throws -> Bool {
    guard workout.startMs.isFinite, workout.endMs.isFinite, workout.startMs < workout.endMs else {
      throw InvalidWorkoutException("its window is empty or not finite")
    }
    guard !workout.syncIdentifier.isEmpty, let version = Int64(exactly: workout.syncVersion.rounded()),
      version >= 0
    else {
      throw InvalidWorkoutException("its sync identifier or version is unusable")
    }
    let task = await BackgroundTask.begin()
    defer { Task { await task.end() } }

    await deleteDistanceSamples(within: workout)
    do {
      try await write(workout, version: version, structured: true)
      return false
    } catch is StructureRefused {
      // why one version up: a refusal at finishWorkout can already have committed the distance
      // samples, and HealthKit replaces them only under a strictly greater version.
      try await write(workout, version: version + 1, structured: false)
      return true
    }
  }

  // why delete first: the distance parts are keyed by index, so a re-save with fewer parts (or an
  // app update that splits differently) would otherwise leave the extra ones counting towards the
  // runner's totals. Only this app's own samples, inside this workout's window, are removed.
  private static func deleteDistanceSamples(within workout: WorkoutRecord) async {
    let type = HKQuantityType(.distanceWalkingRunning)
    guard isAuthorized(type) else { return }
    // why a millisecond past the end: `.strictEndDate` matches only samples ending before it, and the
    // last part ends exactly at the workout's end; `.strictStartDate` keeps the next run's out.
    let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
      HKQuery.predicateForObjects(from: HKSource.default()),
      HKQuery.predicateForSamples(
        withStart: date(workout.startMs), end: date(workout.endMs + 1),
        options: [.strictStartDate, .strictEndDate]),
    ])
    // why ignored: a stale part is a cosmetic leftover, never a reason to lose the save.
    _ = try? await store.deleteObjects(of: type, predicate: predicate)
  }

  private static func write(_ workout: WorkoutRecord, version: Int64, structured: Bool) async throws {
    let configuration = HKWorkoutConfiguration()
    configuration.activityType = .running
    configuration.locationType = .outdoor
    let builder = HKWorkoutBuilder(healthStore: store, configuration: configuration, device: .local())

    do {
      try await builder.beginCollection(at: date(workout.startMs))
      // per HKWorkoutRouteBuilder.h: with a workout builder the route comes from its series builder
      // and is finished with the workout, so the two commit together.
      if let route = workout.route, !route.points.isEmpty, isAuthorized(HKSeriesType.workoutRoute()),
        let routeBuilder = builder.seriesBuilder(for: HKSeriesType.workoutRoute()) as? HKWorkoutRouteBuilder
      {
        try await routeBuilder.insertRouteData(route.points.map(location))
        try await routeBuilder.addMetadata(syncMetadata(route.syncIdentifier, version: version))
      }
      var metadata = syncMetadata(workout.syncIdentifier, version: version)
      metadata[HKMetadataKeyIndoorWorkout] = false
      metadata[HKMetadataKeyTimeZone] = TimeZone.current.identifier
      try await builder.addMetadata(metadata)
      if structured {
        try await refusable { try await addStructure(workout, to: builder, configuration: configuration) }
      }
      // why last: addSamples saves at once and discardWorkout does not take it back, so a failure
      // before this point leaves no distance in Health without its workout.
      if !workout.distances.isEmpty, isAuthorized(HKQuantityType(.distanceWalkingRunning)) {
        try await builder.addSamples(workout.distances.map { distanceSample($0, version: version) })
      }
      try await builder.endCollection(at: date(workout.endMs))
      // A nil workout with no error is a locked device's save: done, only not readable until unlock.
      _ = try await refusable(when: structured) { try await builder.finishWorkout() }
    } catch {
      builder.discardWorkout()
      throw error
    }
  }

  private static func addStructure(
    _ workout: WorkoutRecord, to builder: HKWorkoutBuilder, configuration: HKWorkoutConfiguration
  ) async throws {
    let events = pauseEvents(workout)
    if !events.isEmpty { try await builder.addWorkoutEvents(events) }
    for segment in workout.segments {
      try await builder.addWorkoutActivity(
        HKWorkoutActivity(
          workoutConfiguration: configuration,
          start: date(segment.startMs),
          end: date(segment.endMs),
          metadata: [segmentKindKey: segment.kind.rawValue]))
    }
  }

  // HealthKit may refuse the pauses and activities as they are added or only when the workout is
  // finished; either way it reports an invalid argument, which here means "save it plain".
  private static func refusable<T>(
    when applies: Bool = true, _ step: () async throws -> T
  ) async throws -> T {
    do {
      return try await step()
    } catch let error as HKError where applies && error.code == .errorInvalidArgument {
      throw StructureRefused()
    }
  }

  // A pause the run ended in has no resume: the workout simply ends paused.
  private static func pauseEvents(_ workout: WorkoutRecord) -> [HKWorkoutEvent] {
    workout.pauses.flatMap { pause -> [HKWorkoutEvent] in
      let paused = HKWorkoutEvent(type: .pause, dateInterval: instant(pause.startMs), metadata: nil)
      guard pause.endMs < workout.endMs else { return [paused] }
      return [paused, HKWorkoutEvent(type: .resume, dateInterval: instant(pause.endMs), metadata: nil)]
    }
  }

  private static func distanceSample(_ distance: DistanceRecord, version: Int64) -> HKQuantitySample {
    HKQuantitySample(
      type: HKQuantityType(.distanceWalkingRunning),
      quantity: HKQuantity(unit: .meter(), doubleValue: distance.meters),
      start: date(distance.startMs),
      end: date(distance.endMs),
      device: .local(),
      metadata: syncMetadata(distance.syncIdentifier, version: version))
  }

  private static func location(_ point: RoutePointRecord) -> CLLocation {
    CLLocation(
      coordinate: CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude),
      altitude: point.altitude,
      horizontalAccuracy: point.horizontalAccuracy,
      verticalAccuracy: point.verticalAccuracy,
      course: point.course,
      speed: point.speed,
      timestamp: date(point.timestampMs))
  }

  private static func syncMetadata(_ identifier: String, version: Int64) -> [String: Any] {
    [HKMetadataKeySyncIdentifier: identifier, HKMetadataKeySyncVersion: NSNumber(value: version)]
  }

  // why per type: the sheet lets the runner allow workouts but not routes or distance, and a write
  // of a refused type would fail the whole save.
  private static func isAuthorized(_ type: HKObjectType) -> Bool {
    store.authorizationStatus(for: type) == .sharingAuthorized
  }

  private static func date(_ ms: Double) -> Date {
    Date(timeIntervalSince1970: ms / 1000)
  }

  private static func instant(_ ms: Double) -> DateInterval {
    DateInterval(start: date(ms), duration: 0)
  }
}

// A run usually ends with the phone locked and the app about to be suspended; this keeps the write
// running to its end (iOS allows about 30 s).
@MainActor
private final class BackgroundTask {
  private var id = UIBackgroundTaskIdentifier.invalid

  static func begin() -> BackgroundTask {
    let task = BackgroundTask()
    task.id = UIApplication.shared.beginBackgroundTask(withName: "Health.saveWorkout") {
      task.end()
    }
    return task
  }

  func end() {
    guard id != .invalid else { return }
    UIApplication.shared.endBackgroundTask(id)
    id = .invalid
  }
}
