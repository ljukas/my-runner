import ExpoModulesCore
import HealthKit
import UIKit

// Mirrors `HealthAuthorizationStatus` in ../types.ts; `updateRequired` is Health Connect's alone.
enum HealthAuthorization: String, Enumerable {
  case authorized
  case denied
  case notDetermined
  case unavailable
  case updateRequired
}

// Write-only by construction (ADR 0011 §2): nothing here asks to read, or reads, health data.
public final class HealthModule: Module {
  private static let shareTypes: Set<HKSampleType> = [
    HKObjectType.workoutType(),
    HKSeriesType.workoutRoute(),
    HKQuantityType(.distanceWalkingRunning),
  ]

  public func definition() -> ModuleDefinition {
    Name("Health")

    // Declared for the shared API; HealthKit has no rationale request, and the JS side re-reads the
    // status on foreground and after a request.
    Events("onAuthorizationChange", "onRationale")

    Function("authorizationStatus") { Self.status() }

    Function("consumeRationale") { false }

    AsyncFunction("requestWriteAccess") { () async throws -> HealthAuthorization in
      guard HKHealthStore.isHealthDataAvailable() else { return .unavailable }
      try await rethrowingHealthKitErrors {
        try await WorkoutWriter.store.requestAuthorization(toShare: Self.shareTypes, read: [])
      }
      return Self.status()
    }

    AsyncFunction("saveWorkout") { (workout: WorkoutRecord) async throws -> SaveResultRecord in
      SaveResultRecord(plain: try await rethrowingHealthKitErrors { try await WorkoutWriter.save(workout) })
    }

    AsyncFunction("openSettings") { () async in
      await Self.openHealth()
    }

    AsyncFunction("openStore") {}
  }

  private static func status() -> HealthAuthorization {
    guard HKHealthStore.isHealthDataAvailable() else { return .unavailable }
    switch WorkoutWriter.store.authorizationStatus(for: HKObjectType.workoutType()) {
    case .sharingAuthorized: return .authorized
    case .sharingDenied: return .denied
    default: return .notDetermined
    }
  }

  // why the fallback: Apple publishes no link to an app's page in Health, and `x-apple-health://`
  // (undocumented, verified on-device) opens Health's root; Settings beats no link at all.
  @MainActor
  private static func openHealth() async {
    if let health = URL(string: "x-apple-health://"), await UIApplication.shared.open(health) {
      return
    }
    if let settings = URL(string: UIApplication.openSettingsURLString) {
      _ = await UIApplication.shared.open(settings)
    }
  }
}
