import ByteSizeKit
import SwiftUI

/// Signed out → sign-in; signed in → the app; while checking a saved login → the logo.
struct RootView: View {
    let session: SessionStore
    @State private var signIn: SignInModel
    @State private var shell = ShellModel()
    @Environment(\.palette) private var palette

    init(session: SessionStore) {
        self.session = session
        _signIn = State(initialValue: SignInModel(session: session))
    }

    var body: some View {
        Group {
            switch session.state {
            case .restoring:
                VStack(spacing: 16) {
                    Image("Logo").resizable().interpolation(.none).frame(width: 96, height: 96)
                        .clipShape(RoundedRectangle(cornerRadius: 22))
                    ProgressView()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(palette.color("page").ignoresSafeArea())
            case .signedOut:
                SignInView(model: signIn)
            case .signedIn:
                MainTabView(shell: shell)
            }
        }
        .onChange(of: session.state) { _, state in
            // A fresh form each time someone lands on sign-in (password cleared, remembered server kept)
            switch state {
            case .signedOut: signIn = SignInModel(session: session)
            case .signedIn: shell = ShellModel() // each sign-in starts on the Dashboard
            case .restoring: break
            }
        }
    }
}
