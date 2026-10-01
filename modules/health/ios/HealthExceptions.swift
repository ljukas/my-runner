import ExpoModulesCore
import HealthKit

final class InvalidWorkoutException: GenericException<String>, @unchecked Sendable {
  override var reason: String { "The workout is not writable: \(param)" }
}

/// Carries HealthKit's own error code to JS (`ERR_HEALTHKIT_<code>`), where it would otherwise
/// arrive as an opaque `ERR_UNEXPECTED`.
final class HealthKitException: GenericException<HKError>, @unchecked Sendable {
  override var code: String { "ERR_HEALTHKIT_\(param.code.rawValue)" }
  override var reason: String { param.localizedDescription }
}

func rethrowingHealthKitErrors<T>(_ body: () async throws -> T) async throws -> T {
  do {
    return try await body()
  } catch let error as HKError {
    throw HealthKitException(error)
  }
}
