package expo.modules.health

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

// Write-only by construction (ADR 0011 §2): nothing here asks to read, or reads, health data.
class HealthModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val status by lazy { HealthStatus(context) { sendEvent("onAuthorizationChange", mapOf("status" to it.value)) } }
  private val writer by lazy { WorkoutWriter(context) }
  private val rationale = Rationale {
    observingRationale.also { if (it) sendEvent("onRationale") }
  }
  @Volatile private var observingRationale = false
  private val requesting = Mutex()
  private var dialog: CancellableContinuation<Set<String>>? = null

  override fun definition() = ModuleDefinition {
    Name("Health")

    Events("onAuthorizationChange", "onRationale")

    OnStartObserving("onRationale") { observingRationale = true }
    OnStopObserving("onRationale") { observingRationale = false }

    OnCreate { refreshInBackground() }

    // Grants change in Health Connect, and an install or update in the Play Store, both while the
    // app is suspended; a cold start through the rationale link arrives as the launch intent.
    OnActivityEntersForeground {
      rationale.note(appContext.currentActivity?.intent)
      refreshInBackground()
    }

    OnNewIntent { rationale.note(it) }

    // An activity destroyed under the dialog never gets its result; settle on what was granted.
    OnActivityDestroys { dialog?.takeIf { it.isActive }?.resume(emptySet()) }

    Function("authorizationStatus") { status.current.value }

    Function("consumeRationale") { rationale.consume() }

    AsyncFunction("requestWriteAccess") Coroutine { -> requestWriteAccess().value }

    AsyncFunction("saveWorkout") Coroutine { workout: WorkoutRecord ->
      if (status.sdkUnavailable() != null) throw HealthConnectUnavailableException()
      val plain = withContext(Dispatchers.IO) {
        try {
          writer.save(workout)
        } catch (error: NotAuthorizedException) {
          status.refresh()
          throw error
        } catch (error: CodedException) {
          throw error
        } catch (error: CancellationException) {
          throw error
        } catch (error: Exception) {
          throw WriteFailedException(error)
        }
      }
      mapOf("plain" to plain)
    }

    AsyncFunction("openSettings") {
      start(Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)) ||
        start(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
      Unit
    }

    AsyncFunction("openStore") {
      // per Health Connect's get-started guide: the url brings the runner through its onboarding.
      start(
        Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$PROVIDER&url=healthconnect%3A%2F%2Fonboarding"))
          .setPackage("com.android.vending"),
      ) || start(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$PROVIDER")))
      Unit
    }
  }

  private fun refreshInBackground() {
    appContext.backgroundCoroutineScope.launch {
      try {
        status.refresh()
      } catch (error: CancellationException) {
        throw error
      } catch (error: Exception) {
        android.util.Log.w("Health", "Status probe failed", error)
      }
    }
  }

  private suspend fun requestWriteAccess(): HealthAuthorization {
    // why tryLock: a second tap while the dialog is up waits for its answer instead of asking twice.
    if (!requesting.tryLock()) return requesting.withLock { status.current }
    try {
      val before = status.refresh()
      if (before != HealthAuthorization.NOT_DETERMINED && before != HealthAuthorization.DENIED) return before
      val askedAt = SystemClock.elapsedRealtime()
      val granted = showPermissionDialog()
      // Measured on Android 16: the dialog's privacy-policy link relaunches the activity, which
      // closes the dialog with nothing granted, like a refusal. The rationale intent tells the two
      // apart, and can land just after the result; reading the policy is not an answer, so the
      // earlier status stands.
      if (granted.isEmpty() && interruptedSince(askedAt)) return before
      status.asked = true
      return status.refresh()
    } finally {
      requesting.unlock()
    }
  }

  // why the activity's own registry, not RegisterActivityContracts: on Android 14+ Health Connect's
  // contract is a runtime-permission request, whose answer arrives in onRequestPermissionsResult —
  // which Expo's registry never receives, so the request would never resolve.
  private suspend fun showPermissionDialog(): Set<String> = withContext(Dispatchers.Main) {
    val activity = appContext.currentActivity as? ComponentActivity ?: throw NotReadyException()
    var launcher: ActivityResultLauncher<Set<String>>? = null
    try {
      suspendCancellableCoroutine { continuation ->
        dialog = continuation
        var launched = false
        // why `launched`: the registry hands a result stored for this key while nothing was
        // registered (an activity destroyed under an earlier dialog) to register() itself.
        launcher = activity.activityResultRegistry.register(
          DIALOG_KEY,
          PermissionController.createRequestPermissionResultContract(),
        ) { granted -> if (launched && continuation.isActive) continuation.resume(granted) }
        launched = true
        launcher?.launch(WritePermissions.all.toSet())
      }
    } finally {
      dialog = null
      launcher?.unregister()
    }
  }

  private suspend fun interruptedSince(askedAt: Long): Boolean {
    // why the main-thread hop first: a new intent queued with the result is delivered after it.
    withContext(Dispatchers.Main) {}
    if (rationale.seenSince(askedAt)) return true
    delay(RATIONALE_GRACE_MS)
    return rationale.seenSince(askedAt)
  }

  private fun start(intent: Intent): Boolean {
    val activity = appContext.currentActivity
    return try {
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      true
    } catch (_: ActivityNotFoundException) {
      false
    }
  }

  private companion object {
    const val DIALOG_KEY = "expo.modules.health.permissions"
    const val PROVIDER = "com.google.android.apps.healthdata"
    // why 500 ms: a margin, not a measurement (the JS adapter before stage 5c waited up to 1 s).
    const val RATIONALE_GRACE_MS = 500L
  }
}
