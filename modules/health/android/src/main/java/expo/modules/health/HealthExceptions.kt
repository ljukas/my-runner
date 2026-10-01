package expo.modules.health

import expo.modules.kotlin.exception.CodedException

internal class InvalidWorkoutException(reason: String) :
  CodedException("ERR_HEALTH_CONNECT_INVALID_WORKOUT", "The workout is not writable: $reason", null)

internal class HealthConnectUnavailableException :
  CodedException("ERR_HEALTH_CONNECT_UNAVAILABLE", "Health Connect is not available", null)

internal class NotAuthorizedException(cause: Throwable? = null) :
  CodedException("ERR_HEALTH_CONNECT_NOT_AUTHORIZED", "Writing exercise is not permitted", cause)

internal class WorkoutRejectedException(cause: Throwable) :
  CodedException("ERR_HEALTH_CONNECT_REJECTED", "Health Connect refused the workout", cause)

internal class WriteFailedException(cause: Throwable) :
  CodedException("ERR_HEALTH_CONNECT_FAILED", cause.message ?: "The write failed", cause)

internal class NotReadyException :
  CodedException("ERR_HEALTH_CONNECT_NOT_READY", "No activity to show the permission dialog from", null)
