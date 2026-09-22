package expo.modules.launchintent

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The action of the intent that started (or re-surfaced) the activity. React Native's Linking only
// exposes an intent's data URI, and Health Connect's permission-rationale intents carry none — per
// ADR 0011's Android amendment.
class LaunchIntentModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LaunchIntent")

    Events("onIntent")

    Function("getAction") { appContext.currentActivity?.intent?.action }

    OnNewIntent { intent ->
      sendEvent("onIntent", mapOf("action" to intent.action))
    }
  }
}
