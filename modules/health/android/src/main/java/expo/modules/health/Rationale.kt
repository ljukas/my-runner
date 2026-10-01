package expo.modules.health

import android.content.Intent
import android.os.SystemClock

/**
 * Health Connect's privacy-policy requests (ADR 0011, 2026-09-22 amendment). They carry no URL, so
 * React Native's Linking never sees them; the dialog's link sends one while it is open.
 */
internal class Rationale(private val deliver: () -> Boolean) {
  private val actions = setOf(
    "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE", // Android 13 and below
    "android.intent.action.VIEW_PERMISSION_USAGE", // Android 14+, through the manifest alias
  )

  @Volatile private var pending = false
  @Volatile private var lastAt = 0L

  fun note(intent: Intent?) {
    if (intent == null || intent.action !in actions || intent.getBooleanExtra(SEEN, false)) return
    // why the extra: the launch intent stays the activity's intent and is re-read on each resume.
    intent.putExtra(SEEN, true)
    lastAt = SystemClock.elapsedRealtime()
    if (!deliver()) pending = true
  }

  fun consume(): Boolean = pending.also { pending = false }

  fun seenSince(elapsedRealtime: Long): Boolean = lastAt >= elapsedRealtime

  private companion object {
    const val SEEN = "expo.modules.health.rationaleSeen"
  }
}
