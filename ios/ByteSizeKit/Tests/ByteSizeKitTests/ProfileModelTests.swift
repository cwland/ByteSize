import XCTest
@testable import ByteSizeKit

@MainActor
final class ProfileModelTests: XCTestCase {
    private var defaults: UserDefaults!
    private var tokens: InMemoryTokenStore!

    override func setUp() async throws {
        defaults = UserDefaults(suiteName: "ProfileModelTests-\(UUID().uuidString)")
        tokens = InMemoryTokenStore()
        HTTPStub.requests = []
    }

    private func signedIn(theme: String? = "harbor", mode: String? = "light", displayName: String? = "Cory") async throws -> SessionStore {
        let name = displayName.map { "\"\($0)\"" } ?? "null"
        let t = theme.map { "\"\($0)\"" } ?? "null"
        let m = mode.map { "\"\($0)\"" } ?? "null"
        let user = #"{"id":1,"username":"cory","displayName":\#(name),"email":null,"isAdmin":false,"theme":\#(t),"colorMode":\#(m),"units":"imperial"}"#
        HTTPStub.routes(["/api/auth/login": .json(200, #"{"token":"abc","user":\#(user)}"#)])
        let session = SessionStore(tokens: tokens, defaults: defaults, session: HTTPStub.session)
        try await session.signIn(server: ServerAddress("https://bytesize.example.com")!, username: "cory", password: "pw")
        return session
    }

    func testFollowsTheAccount() async throws {
        let m = ProfileModel(session: try await signedIn(), defaults: defaults)
        XCTAssertNil(m.themeOverride)
        XCTAssertNil(m.modeOverride)
        XCTAssertEqual(m.effectiveTheme, .harbor)
        XCTAssertEqual(m.effectiveMode, .light)
    }

    func testOverridesWinAndAreRemembered() async throws {
        let session = try await signedIn()
        let m = ProfileModel(session: session, defaults: defaults)
        m.themeOverride = .fresh
        m.modeOverride = .dark
        XCTAssertEqual(m.effectiveTheme, .fresh)
        XCTAssertEqual(m.effectiveMode, .dark)
        let again = ProfileModel(session: session, defaults: defaults)
        XCTAssertEqual(again.themeOverride, .fresh)
        XCTAssertEqual(again.modeOverride, .dark)
    }

    func testClearingAnOverrideFollowsTheAccountAgain() async throws {
        let session = try await signedIn()
        let m = ProfileModel(session: session, defaults: defaults)
        m.themeOverride = .fresh
        m.themeOverride = nil
        XCTAssertEqual(m.effectiveTheme, .harbor)
        XCTAssertNil(ProfileModel(session: session, defaults: defaults).themeOverride)
    }

    func testUnknownOrMissingAccountChoicesUseTheDefaults() async throws {
        let m = ProfileModel(session: try await signedIn(theme: "zzz", mode: nil), defaults: defaults)
        XCTAssertEqual(m.effectiveTheme, Theme.defaultTheme)
        XCTAssertEqual(m.effectiveMode, Theme.defaultMode)
    }

    func testSignedOutUsesDefaults() {
        let session = SessionStore(tokens: tokens, defaults: defaults, session: HTTPStub.session)
        let m = ProfileModel(session: session, defaults: defaults)
        XCTAssertEqual(m.effectiveTheme, Theme.defaultTheme)
        XCTAssertEqual(m.effectiveMode, Theme.defaultMode)
        XCTAssertEqual(m.displayName, "")
    }

    func testNames() async throws {
        let m = ProfileModel(session: try await signedIn(), defaults: defaults)
        XCTAssertEqual(m.displayName, "Cory")
        XCTAssertEqual(m.username, "cory")
        XCTAssertEqual(m.serverHost, "bytesize.example.com")
        let plain = ProfileModel(session: try await signedIn(displayName: nil), defaults: defaults)
        XCTAssertEqual(plain.displayName, "cory")
    }

    func testSignOut() async throws {
        let session = try await signedIn()
        HTTPStub.routes(["/api/auth/logout": .json(200, #"{"ok":true}"#)])
        let m = ProfileModel(session: session, defaults: defaults)
        await m.signOut()
        XCTAssertEqual(session.state, .signedOut(notice: nil))
        XCTAssertNil(tokens.read())
    }
}
