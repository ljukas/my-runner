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
  override var reason: String { "The workout's window is empty or not finite" }
}

enum WorkoutWriter {
  /// Writes the workout once the phone is unlocked; true when it was saved without its pauses and
  /// segments because HealthKit refused them.
  static func save(_ workout: WorkoutRecord) async throws -> Bool {
    guard workout.startMs.isFinite, workout.endMs.isFinite, workout.startMs < workout.endMs else {
      throw InvalidWorkoutException()
    }
    let maxAttempts = 3
    for attempt in 1...maxAttempts {
      await ProtectedData.waitUntilAvailable()
      let backgroundTask = await UIApplication.shared.beginBackgroundTask(withName: "AppleHealth.save")
      defer { Task { @MainActor in UIApplication.shared.endBackgroundTask(backgroundTask) } }
      // why a rising version per attempt: a failed attempt can already have committed the workout,
      // and HealthKit only replaces it under a strictly greater HKMetadataKeySyncVersion.
      let version = Int64(workout.syncVersion) + Int64(attempt - 1)
      do {
        do {
          try await write(workout, version: version, structured: true)
          return false
        } catch let error as HKError where error.code == .errorInvalidArgument && hasStructure(workout) {
          try await write(workout, version: version + 1, structured: false)
          return true
        }
      } catch let error as HKError where error.code == .errorDatabaseInaccessible && attempt < maxAttempts {
        continue  // relocked mid-write: wait for the next unlock and write it all again
      }
    }
    preconditionFailure("unreachable: the last attempt returns or throws")
  }

  private static func hasStructure(_ workout: WorkoutRecord) -> Bool {
    !workout.pauses.isEmpty || !workout.segments.isEmpty
  }

  private static func write(_ workout: WorkoutRecord, version: Int64, structured: Bool) async throws {
    let configuration = HKWorkoutConfiguration()
    configuration.activityType = .running
    configuration.locationType = .outdoor
    let builder = HKWorkoutBuilder(healthStore: healthStore, configuration: configuration, device: .local())

    let saved: HKWorkout
    do {
      try await builder.beginCollection(at: date(workout.startMs))
      if !workout.distances.isEmpty, isAuthorized(HKQuantityType(.distanceWalkingRunning)) {
        try await builder.addSamples(workout.distances.map { distanceSample($0, version: version) })
      }
      if structured {
        let events = pauseEvents(workout)
        if !events.isEmpty { try await builder.addWorkoutEvents(events) }
        for segment in workout.segments {
          try await builder.addWorkoutActivity(
            HKWorkoutActivity(
              workoutConfiguration: configuration,
              start: date(segment.startMs),
              end: date(segment.endMs),
              metadata: [segmentKindKey: segment.kind]))
        }
      }
      try await builder.addMetadata(syncMetadata(workout.syncIdentifier, version: version))
      try await builder.endCollection(at: date(workout.endMs))
      // why nil is an inaccessible database: HealthKit saved the workout but cannot hand it back
      // while locked; the retry replaces it under the next version.
      guard let finished = try await builder.finishWorkout() else {
        throw HKError(.errorDatabaseInaccessible)
      }
      saved = finished
    } catch {
      builder.discardWorkout()
      throw error
    }

    if let route = workout.route, !route.points.isEmpty, isAuthorized(HKSeriesType.workoutRoute()) {
      let routeBuilder = HKWorkoutRouteBuilder(healthStore: healthStore, device: .local())
      try await routeBuilder.insertRouteData(route.points.map(location))
      _ = try await routeBuilder.finishRoute(
        with: saved, metadata: syncMetadata(route.syncIdentifier, version: version))
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
