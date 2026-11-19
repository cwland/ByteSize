import ByteSizeKit
import SwiftUI

@main
struct ByteSizeApp: App {
    @State private var session = SessionStore(tokens: KeychainTokenStore())

    var body: some Scene {
        WindowGroup {
            RootView(session: session)
                .byteSizeTheme(id: Theme.defaultTheme, mode: Theme.defaultMode)
                .task { await session.restore() }
        }
    }
}
