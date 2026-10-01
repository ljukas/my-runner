import ExpoModulesCore
import HealthKit

// Write-only by construction (ADR 0011 §2): nothing here asks to read, or reads, health data.
public final class AppleHealthModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppleHealth")

    Function("isAvailable") {
      HKHealthStore.isHealthDataAvailable()
    }

    Function("authorizationStatus") { () -> String in
      switch healthStore.authorizationStatus(for: HKObjectType.workoutType()) {
      case .sharingAuthorized: return "authorized"
      case .sharingDenied: return "denied"
      default: return "notDetermined"
      }
    }

    AsyncFunction("requestWriteAccess") { () async throws in
      try await healthStore.requestAuthorization(toShare: shareTypes, read: [])
    }

    AsyncFunction("saveWorkout") { (workout: WorkoutRecord) async throws -> [String: Bool] in
      ["plain": try await WorkoutWriter.save(workout)]
    }
  }
}
