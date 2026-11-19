import XCTest
@testable import ByteSizeKit

@MainActor
final class SignInModelTests: XCTestCase {
    private var defaults: UserDefaults!
    private var tokens: InMemoryTokenStore!
    private let userJSON = AuthServiceTests.userJSON
    private let health = HTTPStub.Reply.json(200, #"{"ok":true,"db":true,"version":"1.4.0"}"#)
    private let statusOK = HTTPStub.Reply.json(200, #"{"setupRequired":false,"passwords":true,"forgotPassword":true,"oauth":null}"#)

    override func setUp() async throws {
        defaults = UserDefaults(suiteName: "SignInModelTests-\(UUID().uuidString)")
        tokens = InMemoryTokenStore()
        HTTPStub.requests = []
    }

    private func model() -> (SignInModel, SessionStore) {
        let session = SessionStore(tokens: tokens, defaults: defaults, session: HTTPStub.session)
        return (SignInModel(session: session), session)
    }

    private func connected() async -> (SignInModel, SessionStore) {
        HTTPStub.routes(["/api/health": health, "/api/auth/status": statusOK])
        let (m, s) = model()
        m.serverText = "h.test"
        await m.connect()
        return (m, s)
    }

    func testStartsOnServerOtherwise() {
        XCTAssertEqual(model().0.step, .server)
    }

    func testStartsOnCredentialsWhenServerRemembered() async {
        defaults.set("https://h.test", forKey: "serverAddress")
        HTTPStub.routes(["/api/health": health, "/api/auth/status": statusOK])
        let (m, _) = model()
        XCTAssertEqual(m.step, .credentials)
        XCTAssertEqual(m.address?.host, "h.test")
        await m.load()
        XCTAssertEqual(m.options?.forgotPassword, true)
    }

    func testConnectChecksHealthThenStatus() async {
        let (m, _) = await connected()
        XCTAssertEqual(m.step, .credentials)
        XCTAssertEqual(m.serverVersion, "1.4.0")
        XCTAssertEqual(m.options?.forgotPassword, true)
        XCTAssertNil(m.error)
        XCTAssertEqual(HTTPStub.requests.map { $0.request.url?.path() }, ["/api/health", "/api/auth/status"])
    }

    func testConnectBadAddress() async {
        let (m, _) = model()
        m.serverText = "not a url"
        await m.connect()
        XCTAssertEqual(m.error, "Enter your ByteSize address, like bytesize.example.com")
        XCTAssertEqual(m.step, .server)
        XCTAssertTrue(HTTPStub.requests.isEmpty)
    }

    func testConnectUnreachable() async {
        HTTPStub.handler = { _ in .fail(.cannotFindHost) }
        let (m, _) = model()
        m.serverText = "h.test"
        await m.connect()
        XCTAssertEqual(m.error, "Can't reach ByteSize at h.test")
        XCTAssertEqual(m.step, .server)
    }

    func testSetupRequired() async {
        HTTPStub.routes(["/api/health": health, "/api/auth/status": .json(200, #"{"setupRequired":true,"passwords":true,"forgotPassword":false,"oauth":null}"#)])
        let (m, _) = model()
        m.serverText = "h.test"
        await m.connect()
        XCTAssertEqual(m.error, "This ByteSize server isn't set up yet. Finish setup in the web app first.")
        XCTAssertEqual(m.step, .server)
    }

    func testPasswordsOff() async {
        HTTPStub.routes(["/api/health": health, "/api/auth/status": .json(200, #"{"setupRequired":false,"passwords":false,"forgotPassword":false,"oauth":{"label":"Authentik"}}"#)])
        let (m, _) = model()
        m.serverText = "h.test"
        await m.connect()
        XCTAssertFalse(m.showsPasswordForm)
        XCTAssertEqual(m.error, "This server signs in with Authentik. That's coming to the app soon — use the web app for now.")
    }

    func testCanSignIn() async {
        let (m, _) = await connected()
        XCTAssertFalse(m.canSignIn)
        m.username = "  alex "
        XCTAssertFalse(m.canSignIn)
        m.password = "pw"
        XCTAssertTrue(m.canSignIn)
        m.username = "   "
        XCTAssertFalse(m.canSignIn)
    }

    func testSignInSuccess() async {
        let (m, s) = await connected()
        HTTPStub.routes(["/api/auth/login": .json(200, #"{"token":"abc","user":\#(userJSON)}"#)])
        m.username = " alex "
        m.password = "pw"
        await m.signIn()
        XCTAssertEqual(HTTPStub.requests.first?.json?["username"] as? String, "alex")
        guard case .signedIn = s.state else { return XCTFail("not signed in") }
    }

    func testSignInErrorShown() async {
        let (m, _) = await connected()
        HTTPStub.routes(["/api/auth/login": .json(401, #"{"error":"Wrong username or password"}"#)])
        m.username = "alex"
        m.password = "nope"
        await m.signIn()
        XCTAssertEqual(m.error, "Wrong username or password")
        XCTAssertEqual(m.password, "")
        XCTAssertEqual(m.username, "alex")
        XCTAssertFalse(m.busy)
    }

    func testChangeServer() async {
        let (m, _) = await connected()
        m.changeServer()
        XCTAssertEqual(m.step, .server)
        XCTAssertEqual(m.serverText, "h.test")
        XCTAssertNil(m.options)
    }

    func testResetFlowSignsIn() async {
        let (m, s) = await connected()
        m.startReset()
        XCTAssertEqual(m.resetStep, .email)
        HTTPStub.routes([
            "/api/auth/forgot": .json(200, #"{"ok":true,"message":"If that email has an account, a code is on its way."}"#),
            "/api/auth/reset": .json(200, #"{"token":"new","user":\#(userJSON)}"#),
        ])
        m.resetEmail = "c@x.com"
        await m.sendCode()
        XCTAssertEqual(m.resetStep, .code)
        XCTAssertEqual(m.resetNotice, "If that email has an account, a code is on its way.")
        m.resetCode = "123456"
        m.newPassword = "a long new password"
        await m.resetPassword()
        guard case .signedIn = s.state else { return XCTFail("not signed in") }
        XCTAssertEqual(tokens.read(), "new")
        XCTAssertNil(m.resetStep)
    }

    func testResetBadCodeStays() async {
        let (m, _) = await connected()
        m.startReset()
        HTTPStub.routes([
            "/api/auth/forgot": .json(200, #"{"ok":true,"message":"Sent"}"#),
            "/api/auth/reset": .json(400, #"{"error":"Invalid request","details":[{"path":"code","message":"Enter the 6-digit code from the email"}]}"#),
        ])
        m.resetEmail = "c@x.com"
        await m.sendCode()
        m.resetCode = "12"
        m.newPassword = "a long new password"
        await m.resetPassword()
        XCTAssertEqual(m.resetError, "Enter the 6-digit code from the email")
        XCTAssertEqual(m.resetStep, .code)
    }

    func testShowsSignedOutNotice() async {
        defaults.set("https://h.test", forKey: "serverAddress")
        tokens.write("old")
        HTTPStub.routes(["/api/auth/me": .json(401, #"{"error":"Not logged in"}"#)])
        let (m, s) = model()
        await s.restore()
        XCTAssertEqual(m.notice, "You were signed out")
    }
}
