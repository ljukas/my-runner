import ExpoModulesCore
import HealthKit

enum HealthAuthorization: String, Enumerable {
  case authorized
  case denied
  case notDetermined
}

// Write-only by construction (ADR 0011 §2): nothing here asks to read, or reads, health data.
public final class AppleHealthModule: Module {
  private static let shareTypes: Set<HKSampleType> = [
    HKObjectType.workoutType(),
    HKSeriesType.workoutRoute(),
    HKQuantityType(.distanceWalkingRunning),
  ]

  public func definition() -> ModuleDefinition {
    Name("AppleHealth")

    Function("isAvailable") {
      HKHealthStore.isHealthDataAvailable()
    }

    Function("authorizationStatus") { () -> HealthAuthorization in
      switch WorkoutWriter.store.authorizationStatus(for: HKObjectType.workoutType()) {
      case .sharingAuthorized: return .authorized
      case .sharingDenied: return .denied
      default: return .notDetermined
      }
    }

    AsyncFunction("requestWriteAccess") { () async throws in
      try await rethrowingHealthKitErrors {
        try await WorkoutWriter.store.requestAuthorization(toShare: Self.shareTypes, read: [])
      }
    }

    AsyncFunction("saveWorkout") { (workout: WorkoutRecord) async throws -> SaveResultRecord in
      SaveResultRecord(plain: try await rethrowingHealthKitErrors { try await WorkoutWriter.save(workout) })
    }
  }
}
