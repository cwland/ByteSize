import ByteSizeKit
import SwiftUI

/// Signed out → sign-in; signed in → the app; while checking a saved login → the logo.
struct RootView: View {
    let session: SessionStore
    let profile: ProfileModel
    @State private var signIn: SignInModel
    @State private var shell = ShellModel()
    @State private var today: TodayModels?
    @Environment(\.palette) private var palette

    init(session: SessionStore, profile: ProfileModel) {
        self.session = session
        self.profile = profile
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
            case .signedIn(let user):
                if let today {
                    MainTabView(shell: shell, profile: profile, today: today)
                } else {
                    Color.clear.onAppear { startToday(user) }
                }
            }
        }
        .onChange(of: session.state) { _, state in
            // A fresh form each time someone lands on sign-in (password cleared, remembered server kept)
            switch state {
            case .signedOut:
                signIn = SignInModel(session: session)
                today = nil
            case .signedIn(let user):
                // The same person with a changed account (units saved in Profile): fresh models, same screen
                if today?.userId != user.id { shell = ShellModel() } // each sign-in starts on the Dashboard
                startToday(user)
            case .restoring: break
            }
        }
    }

    private func startToday(_ user: User) {
        guard let api = session.api else { return }
        if today?.user == user { return } // already made for this account (sign-in shows the app and reports the change)
        today = TodayModels(api: api, user: user, account: "\(session.server?.host ?? "")|\(user.id)", session: session)
    }
}
