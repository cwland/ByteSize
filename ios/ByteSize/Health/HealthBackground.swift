import ByteSizeKit
import Foundation
import HealthKit
import UIKit

/// Background delivery (I5): Health wakes the app when new weight (right away) or steps (hourly) arrive, and the
/// app syncs for the last signed-in account, even if it wasn't opened. Started at launch and when a switch turns on.
@MainActor
final class HealthBackground {
    static let shared = HealthBackground()
    private var watching: Set<HealthKind> = []

    func start() {
        #if DEBUG
        if UITestHealthStore.isOn || StubServer.isOn { return }
        #endif
        guard HKHealthStore.isHealthDataAvailable(), let account = HealthSync.lastAccount(.standard) else { return }
        let store = HealthKitStore.shared.store
        for kind in HealthSync.savedOn(account: account, defaults: .standard) where kind != .workouts && !watching.contains(kind) {
            watching.insert(kind)
            let type = HealthKitStore.sampleType(kind)
            let query = HKObserverQuery(sampleType: type, predicate: nil) { _, done, error in
                nonisolated(unsafe) let finish = done
                guard error == nil else { finish(); return }
                Task { @MainActor in
                    await HealthBackground.shared.syncInBackground()
                    finish()
                }
            }
            store.execute(query)
            store.enableBackgroundDelivery(for: type, frequency: kind == .weight ? .immediate : .hourly) { _, _ in }
        }
    }

    /// Signs in from the Keychain (no screens) and syncs what's switched on. Health can't be read while the phone
    /// is locked; then nothing is sent and the next open catches up.
    func syncInBackground() async {
        let session = SessionStore(tokens: KeychainTokenStore())
        await session.restore()
        guard case .signedIn(let user) = session.state, let api = session.api else { return }
        let zone = user.timezone.flatMap(TimeZone.init(identifier:)) ?? .current
        let days = DayStore(api: api, timeZone: zone)
        let sync = HealthSync(api: api, dayStore: days, store: HealthKitStore.shared, account: "\(session.server?.host ?? "")|\(user.id)")
        await sync.syncNow()
    }
}

/// Starts background delivery as early as iOS launches the app (also when Health wakes it in the background).
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        MainActor.assumeIsolated { HealthBackground.shared.start() }
        return true
    }
}
