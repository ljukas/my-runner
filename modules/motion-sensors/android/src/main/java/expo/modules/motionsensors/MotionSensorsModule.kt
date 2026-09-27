package expo.modules.motionsensors

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val TAG = "MotionSensors"
private const val PRESSURE_PERIOD_US = 1_000_000
// why batched: lets the sensor hub hold readings in its FIFO while the CPU sleeps between location
// fixes, instead of dropping them (a non-wake-up sensor's events are lost while suspended).
private const val PRESSURE_MAX_LATENCY_US = 5_000_000
// why thinned here: the period is only a hint — the sensor runs at its fastest client's rate and
// every client gets every event (Play services' location validation asks for 10 Hz whenever a
// location session is live). Keyed on the event's own clock so a batched burst is thinned by when
// each reading was taken, not when it arrived. Just under 1 s so jitter can't halve the cadence.
private const val PRESSURE_MIN_GAP_NS = 950_000_000L
// Same FIFO reason as the barometer. The cost is that a count read at finalize can miss the last
// few seconds of steps — this count is a diagnostic, not a metric.
private const val STEP_MAX_LATENCY_US = 5_000_000

// Registers on SensorManager directly and ignores the Activity lifecycle — per ADR 0015's
// 2026-09-27 amendment, which has why expo-sensors cannot serve a screen-off run.
class MotionSensorsModule : Module() {
  private val sensorManager: SensorManager
    get() = (appContext.reactContext ?: throw Exceptions.ReactContextLost())
      .getSystemService(Context.SENSOR_SERVICE) as SensorManager

  private var pressureListener: SensorEventListener? = null
  private var lastPressureAtNs = Long.MIN_VALUE
  private var stepListener: SensorEventListener? = null
  // why volatile: written by sensor callbacks on the main looper, read by stepCounts() on the JS thread.
  @Volatile private var firstSteps: Float? = null
  @Volatile private var latestSteps: Float? = null

  override fun definition() = ModuleDefinition {
    Name("MotionSensors")

    Events("onPressure")

    Function("hasBarometer") { sensor(Sensor.TYPE_PRESSURE) != null }

    Function("startBarometer") { startBarometer() }

    Function("stopBarometer") { stopBarometer() }

    Function("hasStepCounter") { sensor(Sensor.TYPE_STEP_COUNTER) != null }

    Function("startSteps") { startSteps() }

    Function("stopSteps") { stopSteps() }

    Function("stepCounts") {
      val first = firstSteps ?: return@Function null
      val latest = latestSteps ?: return@Function null
      mapOf("first" to first.toDouble(), "latest" to latest.toDouble())
    }

    OnDestroy {
      stopBarometer()
      stopSteps()
    }
  }

  private fun sensor(type: Int): Sensor? =
    sensorManager.getDefaultSensor(type, true) ?: sensorManager.getDefaultSensor(type)

  private fun startBarometer(): Boolean {
    if (pressureListener != null) return true
    val pressure = sensor(Sensor.TYPE_PRESSURE) ?: return false
    lastPressureAtNs = Long.MIN_VALUE
    val listener = object : SensorEventListener {
      override fun onSensorChanged(event: SensorEvent) {
        val tooSoon = event.timestamp - lastPressureAtNs < PRESSURE_MIN_GAP_NS
        if (lastPressureAtNs != Long.MIN_VALUE && tooSoon) return
        lastPressureAtNs = event.timestamp
        sendEvent(
          "onPressure",
          mapOf(
            "pressureHpa" to event.values[0].toDouble(),
            "timestampS" to event.timestamp / 1_000_000_000.0
          )
        )
      }

      override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
    }
    val registered =
      sensorManager.registerListener(listener, pressure, PRESSURE_PERIOD_US, PRESSURE_MAX_LATENCY_US)
    if (registered) pressureListener = listener else Log.w(TAG, "barometer registration refused")
    return registered
  }

  private fun stopBarometer() {
    pressureListener?.let { sensorManager.unregisterListener(it) }
    pressureListener = null
  }

  private fun startSteps(): Boolean {
    if (stepListener != null) return true
    val counter = sensor(Sensor.TYPE_STEP_COUNTER) ?: return false
    firstSteps = null
    latestSteps = null
    val listener = object : SensorEventListener {
      override fun onSensorChanged(event: SensorEvent) {
        val count = event.values[0]
        if (firstSteps == null) firstSteps = count
        latestSteps = count
      }

      override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
    }
    // why guarded: without ACTIVITY_RECOGNITION the framework refuses the registration — by return
    // value or by exception depending on the release.
    val registered = try {
      sensorManager.registerListener(
        listener,
        counter,
        SensorManager.SENSOR_DELAY_NORMAL,
        STEP_MAX_LATENCY_US
      )
    } catch (e: SecurityException) {
      false
    }
    if (registered) stepListener = listener else Log.w(TAG, "step counter registration refused")
    return registered
  }

  private fun stopSteps() {
    stepListener?.let { sensorManager.unregisterListener(it) }
    stepListener = null
  }
}
