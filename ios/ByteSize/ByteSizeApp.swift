import ByteSizeKit
import SwiftUI

@main
struct ByteSizeApp: App {
    @State private var session: SessionStore
    @State private var profile: ProfileModel

    init() {
        let session = SessionStore(tokens: KeychainTokenStore())
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
