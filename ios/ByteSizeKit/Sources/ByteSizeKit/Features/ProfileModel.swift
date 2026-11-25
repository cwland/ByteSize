import Foundation
import Observation

/// The Profile sheet: who's signed in, this phone's look (theme and light/dark, following the account unless
/// overridden here), and sign out. The account's own settings are in AccountSettingsModel.
@MainActor
@Observable
public final class ProfileModel {
    private enum Key {
        static let theme = "themeOverride"
        static let mode = "modeOverride"
    }

    private let session: SessionStore
    private let defaults: UserDefaults

    /// nil = match my account.
    public var themeOverride: ThemeID? {
        didSet { defaults.set(themeOverride?.rawValue, forKey: Key.theme) }
    }

    /// nil = match my account.
    public var modeOverride: ColorMode? {
        didSet { defaults.set(modeOverride?.rawValue, forKey: Key.mode) }
    }

    public init(session: SessionStore, defaults: UserDefaults = .standard) {
        self.session = session
        self.defaults = defaults
        themeOverride = defaults.string(forKey: Key.theme).flatMap(ThemeID.init(rawValue:))
        modeOverride = defaults.string(forKey: Key.mode).flatMap(ColorMode.init(rawValue:))
    }

    private var user: User? {
        if case .signedIn(let user) = session.state { return user }
        return nil
    }

    public var accountTheme: ThemeID { user?.theme.flatMap(ThemeID.init(rawValue:)) ?? Theme.defaultTheme }
    public var accountMode: ColorMode { user?.colorMode.flatMap(ColorMode.init(rawValue:)) ?? Theme.defaultMode }

    public var effectiveTheme: ThemeID { themeOverride ?? accountTheme }
    public var effectiveMode: ColorMode { modeOverride ?? accountMode }

    public var displayName: String { user.map { $0.displayName ?? $0.username } ?? "" }
    public var username: String { user?.username ?? "" }
    public var serverHost: String { session.server?.host ?? "" }

    public func signOut() async {
        await session.signOut()
    }
}
