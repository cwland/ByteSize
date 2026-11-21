import ByteSizeKit
import SwiftUI

@main
struct ByteSizeApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var session: SessionStore
    @State private var profile: ProfileModel

    init() {
        let session: SessionStore
        #if DEBUG
        if StubServer.isOn {
            // UI tests: a pretend server and throwaway settings, nothing saved to the Keychain
            let defaults = StubServer.defaults
            session = SessionStore(tokens: InMemoryTokenStore(), defaults: defaults, session: StubServer.session)
            _session = State(initialValue: session)
            _profile = State(initialValue: ProfileModel(session: session, defaults: defaults))
            return
        }
        #endif
        session = SessionStore(tokens: KeychainTokenStore())
        _session = State(initialValue: session)
        _profile = State(initialValue: ProfileModel(session: session))
    }

    var body: some Scene {
        WindowGroup {
            RootView(session: session, profile: profile)
                .byteSizeTheme(id: profile.effectiveTheme, mode: profile.effectiveMode)
                .task { await session.restore() }
        }
    }
}
