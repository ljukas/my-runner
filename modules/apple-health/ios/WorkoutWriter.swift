import CoreLocation
import ExpoModulesCore
import HealthKit
import UIKit

let healthStore = HKHealthStore()

let shareTypes: Set<HKSampleType> = [
  HKObjectType.workoutType(),
  HKSeriesType.workoutRoute(),
  HKQuantityType(.distanceWalkingRunning),
]

// Apple's guidance for interval workouts: every activity takes the workout's own type, labelled
// with custom metadata. Nothing in Health or Fitness reads this key; it keeps the kind on record.
private let segmentKindKey = "RunBroSegmentKind"

final class InvalidWorkoutException: Exception, @unchecked Sendable {
  override var code: String { "ERR_INVALID_WORKOUT" }
  override var reason: String { "The workout's window or sync version is empty or not finite" }
}

private struct StructureRefused: Error {}

enum WorkoutWriter {
  /// Writes the workout once the phone is unlocked; true when it was saved without its pauses and
  /// segments because HealthKit refused them.
  static func save(_ workout: WorkoutRecord) async throws -> Bool {
    guard workout.startMs.isFinite, workout.endMs.isFinite, workout.startMs < workout.endMs,
      workout.syncVersion.isFinite, workout.syncVersion >= 0
    else {
      throw InvalidWorkoutException()
    }
    let maxAttempts = 3
    for attempt in 1...maxAttempts {
      // why a fresh signal on a retry: the flag can still read available while HealthKit already
      // refuses (the grace period after a lock), and trusting it would burn every attempt at once.
      await ProtectedData.waitUntilAvailable(freshSignal: attempt > 1)
      let task = await BackgroundTask.begin()
      defer { Task { await task.end() } }
      // why two versions per attempt: the plain fallback writes one above the structured write, and
      // HealthKit replaces a stored object only under a strictly greater HKMetadataKeySyncVersion.
      let version = Int64(workout.syncVersion) + 2 * Int64(attempt - 1)
      do {
        do {
          try await write(workout, version: version, structured: true)
          return false
        } catch is StructureRefused {
          try await write(workout, version: version + 1, structured: false)
          return true
        }
      } catch let error as HKError where error.code == .errorDatabaseInaccessible && attempt < maxAttempts {
        continue  // relocked mid-write: wait for the next unlock and write it all again
      }
    }
    preconditionFailure("unreachable: the last attempt returns or throws")
  }

  private static func write(_ workout: WorkoutRecord, version: Int64, structured: Bool) async throws {
    let configuration = HKWorkoutConfiguration()
    configuration.activityType = .running
    configuration.locationType = .outdoor
    let builder = HKWorkoutBuilder(healthStore: healthStore, configuration: configuration, device: .local())

    let finished: HKWorkout?
    do {
      try await builder.beginCollection(at: date(workout.startMs))
      if !workout.distances.isEmpty, isAuthorized(HKQuantityType(.distanceWalkingRunning)) {
        try await builder.addSamples(workout.distances.map { distanceSample($0, version: version) })
      }
      // per HKWorkoutRouteBuilder.h: with a workout builder the route comes from its series builder
      // and is finished with the workout, so the two commit together.
      if let route = workout.route, !route.points.isEmpty, isAuthorized(HKSeriesType.workoutRoute()),
        let routeBuilder = builder.seriesBuilder(for: HKSeriesType.workoutRoute()) as? HKWorkoutRouteBuilder
      {
        try await routeBuilder.insertRouteData(route.points.map(location))
        try await routeBuilder.addMetadata(syncMetadata(route.syncIdentifier, version: version))
      }
      try await builder.addMetadata(syncMetadata(workout.syncIdentifier, version: version))
      if structured {
        try await refusable { try await addStructure(workout, to: builder, configuration: configuration) }
      }
      try await builder.endCollection(at: date(workout.endMs))
      finished = try await refusable(when: structured) { try await builder.finishWorkout() }
    } catch {
      builder.discardWorkout()
      throw error
    }
    // why nil is an inaccessible database: HealthKit saved the workout but cannot hand it back
    // while locked; the retry replaces it under the next version.
    guard finished != nil else { throw HKError(.errorDatabaseInaccessible) }
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
    healthStore.authorizationStatus(for: type) == .sharingAuthorized
  }

  private static func date(_ ms: Double) -> Date {
    Date(timeIntervalSince1970: ms / 1000)
  }

  private static func instant(_ ms: Double) -> DateInterval {
    DateInterval(start: date(ms), duration: 0)
  }
}

// Begun only after the unlock wait: iOS expires a background task within about 30 s, enough for
// the write itself but not for waiting on the runner.
@MainActor
private final class BackgroundTask {
  private var id = UIBackgroundTaskIdentifier.invalid

  static func begin() -> BackgroundTask {
    let task = BackgroundTask()
    task.id = UIApplication.shared.beginBackgroundTask(withName: "AppleHealth.saveWorkout") {
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
