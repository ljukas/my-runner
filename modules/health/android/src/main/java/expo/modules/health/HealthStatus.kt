package expo.modules.health

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

// Mirrors `HealthAuthorizationStatus` in ../types.ts.
internal enum class HealthAuthorization(val value: String) {
  AUTHORIZED("authorized"),
  DENIED("denied"),
  NOT_DETERMINED("notDetermined"),
  UNAVAILABLE("unavailable"),
  UPDATE_REQUIRED("updateRequired"),
}

internal object WritePermissions {
  val exercise = HealthPermission.getWritePermission(ExerciseSessionRecord::class)
  val route = HealthPermission.PERMISSION_WRITE_EXERCISE_ROUTE
  val distance = HealthPermission.getWritePermission(DistanceRecord::class)
  val all = arrayListOf(exercise, route, distance)
}

internal class HealthStatus(
  private val context: Context,
  private val onChange: (HealthAuthorization) -> Unit,
) {
  private val prefs = context.getSharedPreferences("expo.modules.health", Context.MODE_PRIVATE)
  private val probing = Mutex()

  // why the stored last answer: probing is async, and the first read happens during startup; the
  // last known answer is right far more often than a guess, and the probe corrects it.
  @Volatile var current: HealthAuthorization = initial()
    private set

  var asked: Boolean
    get() = prefs.getBoolean(ASKED, false)
    set(value) = prefs.edit().putBoolean(ASKED, value).apply()

  fun sdkStatus(): Int = HealthConnectClient.getSdkStatus(context)

  suspend fun refresh(): HealthAuthorization = probing.withLock { publish(probe()) }

  // why asked: Health Connect reports only grants, so a missing one is undetermined until the app
  // has asked. Authorized needs only exercise; the writer drops a refused route or distance.
  private suspend fun probe(): HealthAuthorization =
    sdkUnavailable() ?: run {
      val granted = HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions()
      when {
        WritePermissions.exercise in granted -> HealthAuthorization.AUTHORIZED
        asked -> HealthAuthorization.DENIED
        else -> HealthAuthorization.NOT_DETERMINED
      }
    }

  fun sdkUnavailable(): HealthAuthorization? = when (sdkStatus()) {
    HealthConnectClient.SDK_AVAILABLE -> null
    HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> HealthAuthorization.UPDATE_REQUIRED
    else -> HealthAuthorization.UNAVAILABLE
  }

  fun publish(next: HealthAuthorization): HealthAuthorization {
    if (next != current) {
      current = next
      prefs.edit().putString(LAST, next.value).apply()
      onChange(next)
    }
    return next
  }

  private fun initial(): HealthAuthorization =
    sdkUnavailable()
      ?: HealthAuthorization.entries.firstOrNull { it.value == prefs.getString(LAST, null) }
        ?.takeIf { it == HealthAuthorization.AUTHORIZED || it == HealthAuthorization.DENIED }
      ?: HealthAuthorization.NOT_DETERMINED

  private companion object {
    const val ASKED = "writeAccessRequested"
    const val LAST = "lastStatus"
  }
}
