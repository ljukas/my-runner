import UIKit

/// HealthKit cannot finish a workout while the phone is locked (`finishWorkout` returns no workout,
/// so its route cannot attach), and plan runs usually end locked — so a save waits for the unlock.
@MainActor
enum ProtectedData {
  static func waitUntilAvailable() async {
    while !UIApplication.shared.isProtectedDataAvailable {
      await nextSignal()
    }
  }

  // why didBecomeActive too: a suspended app never receives the unlock notification, so for a run
  // that ended locked the wait really ends when the app next comes to the foreground.
  private static func nextSignal() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      var observers: [NSObjectProtocol] = []
      var resumed = false
      let resume = {
        guard !resumed else { return }
        resumed = true
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        continuation.resume()
      }
      for name in [
        UIApplication.protectedDataDidBecomeAvailableNotification,
        UIApplication.didBecomeActiveNotification,
      ] {
        observers.append(
          NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
            resume()
          })
      }
      // why re-check after subscribing: an unlock between the caller's check and the observers
      // would otherwise be missed until the next one.
      if UIApplication.shared.isProtectedDataAvailable { resume() }
    }
  }
}
