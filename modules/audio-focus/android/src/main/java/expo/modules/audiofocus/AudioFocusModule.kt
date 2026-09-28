package expo.modules.audiofocus

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.util.Log
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val TAG = "AudioFocus"

// Transient may-duck focus around each spoken cue — per ADR 0009, 2026-09-21 amendment.
class AudioFocusModule : Module() {
  private val audioManager: AudioManager
    get() = (appContext.reactContext ?: throw Exceptions.ReactContextLost())
      .getSystemService(Context.AUDIO_SERVICE) as AudioManager

  // A transient loss (a call, another assistant) leaves our stack entry in place and focus comes
  // back by itself, so only the adapter's abandon() un-ducks. A permanent loss is the framework
  // removing our entry — forget the hold so the next cue requests again instead of speaking unducked.
  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    Log.d(TAG, "focus change: $change")
    if (change == AudioManager.AUDIOFOCUS_LOSS) held = false
  }

  private val focusRequest: AudioFocusRequest? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        // why: the usage Android reserves for spoken guidance over media — the one music players
        // are written to duck for (the turn-by-turn case), unlike USAGE_MEDIA or USAGE_ASSISTANT.
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        .setOnAudioFocusChangeListener(focusListener)
        .build()
    } else {
      null
    }

  private var held = false

  override fun definition() = ModuleDefinition {
    Name("AudioFocus")

    // why: synchronous, so focus is held before the adapter dispatches Speech.speak on the same tick
    // and the first syllable is already ducked.
    Function("request") { request() }

    Function("abandon") { abandon() }
  }

  private fun request(): Boolean {
    if (held) return true
    val result = focusRequest?.let { audioManager.requestAudioFocus(it) }
      ?: @Suppress("DEPRECATION") audioManager.requestAudioFocus(
        focusListener,
        AudioManager.STREAM_MUSIC,
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
      )
    held = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    if (!held) Log.w(TAG, "focus request not granted: $result")
    return held
  }

  private fun abandon() {
    if (!held) return
    held = false
    if (focusRequest != null) {
      audioManager.abandonAudioFocusRequest(focusRequest)
    } else {
      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(focusListener)
    }
  }
}
