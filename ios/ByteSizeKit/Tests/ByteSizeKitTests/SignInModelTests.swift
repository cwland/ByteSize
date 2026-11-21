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

    func testConnectRejectsPlainHTTP() async {
        let (m, _) = model()
        m.serverText = "http://192.168.50.191:4100"
        await m.connect()
        XCTAssertEqual(m.error, "ByteSize needs your secure address, starting with https://")
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
        XCTAssertNil(m.error, "I6: no more \"coming soon\" — the Authentik button is there")
        XCTAssertEqual(m.oauthLabel, "Authentik")
    }

    func testCanSignIn() async {
        let (m, _) = await connected()
        XCTAssertFalse(m.canSignIn)
        m.username = "  cory "
        XCTAssertFalse(m.canSignIn)
        m.password = "pw"
        XCTAssertTrue(m.canSignIn)
        m.username = "   "
        XCTAssertFalse(m.canSignIn)
    }

    func testSignInSuccess() async {
        let (m, s) = await connected()
        HTTPStub.routes(["/api/auth/login": .json(200, #"{"token":"abc","user":\#(userJSON)}"#)])
        m.username = " cory "
        m.password = "pw"
        await m.signIn()
        XCTAssertEqual(HTTPStub.requests.first?.json?["username"] as? String, "cory")
        guard case .signedIn = s.state else { return XCTFail("not signed in") }
    }

    func testSignInErrorShown() async {
        let (m, _) = await connected()
        HTTPStub.routes(["/api/auth/login": .json(401, #"{"error":"Wrong username or password"}"#)])
        m.username = "cory"
        m.password = "nope"
        await m.signIn()
        XCTAssertEqual(m.error, "Wrong username or password")
        XCTAssertEqual(m.password, "")
        XCTAssertEqual(m.username, "cory")
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

    // MARK: - I6: passkeys and Authentik on the phone

    private func login() -> HTTPStub.Reply { .json(200, #"{"token":"tok-1","user":\#(userJSON)}"#) }
    private func recorded(_ path: String) -> [HTTPStub.Recorded] { HTTPStub.requests.filter { $0.request.url?.path() == path } }

    func testThePasskeyButtonShowsAndOAuthOnlyWhenOffered() async {
        let (m, _) = await connected()
        XCTAssertTrue(m.showsPasskey)
        XCTAssertNil(m.oauthLabel)
    }

    func testSignInWithAPasskey() async throws {
        let (m, s) = await connected()
        HTTPStub.routes([
            "/api/passkeys/login/options": .json(200, #"{"challengeId":"c-1","options":{"challenge":"AQID","rpId":"h.test","allowCredentials":[],"userVerification":"preferred"}}"#),
            "/api/passkeys/login/verify": login(),
        ])
        let fake = FakePasskeys(.success(PasskeyAssertion(credentialID: Data([9, 9]), clientDataJSON: Data("{}".utf8), authenticatorData: Data([1]), signature: Data([2]), userID: Data([3]))))
        await m.signInWithPasskey(using: fake)
        XCTAssertNil(m.error)
        XCTAssertEqual(fake.asked?.challenge, Data([1, 2, 3]), "the server's challenge, base64url-decoded")
        XCTAssertEqual(fake.asked?.relyingParty, "h.test")
        for path in ["/api/passkeys/login/options", "/api/passkeys/login/verify"] {
            XCTAssertEqual(recorded(path).last?.request.value(forHTTPHeaderField: "Origin"), "https://h.test", "the origin Apple signs: \(path)")
        }
        let body = try XCTUnwrap(recorded("/api/passkeys/login/verify").last?.json)
        XCTAssertEqual(body["challengeId"] as? String, "c-1")
        let response = try XCTUnwrap(body["response"] as? [String: Any])
        XCTAssertEqual(response["id"] as? String, "CQk")
        XCTAssertEqual(response["rawId"] as? String, "CQk")
        XCTAssertEqual(response["type"] as? String, "public-key")
        let inner = try XCTUnwrap(response["response"] as? [String: Any])
        XCTAssertEqual(inner["clientDataJSON"] as? String, "e30")
        XCTAssertEqual(inner["authenticatorData"] as? String, "AQ")
        XCTAssertEqual(inner["signature"] as? String, "Ag")
        XCTAssertEqual(inner["userHandle"] as? String, "Aw")
        guard case .signedIn = s.state else { return XCTFail("signed in") }
    }

    func testCancellingThePasskeySheetIsQuiet() async {
        let (m, s) = await connected()
        HTTPStub.routes(["/api/passkeys/login/options": .json(200, #"{"challengeId":"c-1","options":{"challenge":"AQID","rpId":"h.test"}}"#)])
        await m.signInWithPasskey(using: FakePasskeys(.failure(SignInCancelled())))
        XCTAssertNil(m.error)
        XCTAssertTrue(recorded("/api/passkeys/login/verify").isEmpty)
        if case .signedIn = s.state { XCTFail("not signed in") }
    }

    func testAPasskeyTheServerRefusesSaysWhy() async {
        let (m, _) = await connected()
        HTTPStub.routes([
            "/api/passkeys/login/options": .json(200, #"{"challengeId":"c-1","options":{"challenge":"AQID","rpId":"h.test"}}"#),
            "/api/passkeys/login/verify": .json(401, #"{"error":"This passkey isn't set up here."}"#),
        ])
        await m.signInWithPasskey(using: FakePasskeys(.success(PasskeyAssertion(credentialID: Data([1]), clientDataJSON: Data(), authenticatorData: Data(), signature: Data(), userID: nil))))
        XCTAssertEqual(m.error, "This passkey isn't set up here.")
    }

    private func oauthServer() async -> (SignInModel, SessionStore) {
        HTTPStub.routes(["/api/health": health, "/api/auth/status": .json(200, #"{"setupRequired":false,"passwords":true,"forgotPassword":false,"oauth":{"label":"Authentik"}}"#)])
        let (m, s) = model()
        m.serverText = "h.test"
        await m.connect()
        return (m, s)
    }

    func testSignInWithAuthentik() async throws {
        let (m, s) = await oauthServer()
        HTTPStub.routes([
            "/api/auth/oauth/start": .json(200, #"{"url":"https://auth.test/authorize?x=1"}"#),
            "/api/auth/oauth/finish": login(),
        ])
        let web = FakeWebAuth(.success(URL(string: "bytesize://oauth?ticket=T-1")!))
        await m.signInWithOAuth(using: web)
        XCTAssertNil(m.error)
        XCTAssertEqual(web.opened?.url.absoluteString, "https://auth.test/authorize?x=1")
        XCTAssertEqual(web.opened?.scheme, "bytesize")
        let start = try XCTUnwrap(recorded("/api/auth/oauth/start").last)
        XCTAssertEqual(start.json?["client"] as? String, "ios")
        let key = try XCTUnwrap(start.json?["appKey"] as? String)
        XCTAssertGreaterThanOrEqual(key.count, 43)
        XCTAssertEqual(start.request.value(forHTTPHeaderField: "Origin"), "https://h.test")
        let finish = try XCTUnwrap(recorded("/api/auth/oauth/finish").last?.json)
        XCTAssertEqual(finish["ticket"] as? String, "T-1")
        XCTAssertEqual(finish["appKey"] as? String, key, "only this app's key swaps the ticket")
        guard case .signedIn = s.state else { return XCTFail("signed in") }
    }

    func testAuthentikSaysWhyItFailed() async {
        let (m, _) = await oauthServer()
        HTTPStub.routes(["/api/auth/oauth/start": .json(200, #"{"url":"https://auth.test/authorize"}"#)])
        await m.signInWithOAuth(using: FakeWebAuth(.success(URL(string: "bytesize://oauth?error=This%20sign-in%20isn%27t%20linked")!)))
        XCTAssertEqual(m.error, "This sign-in isn't linked")
        XCTAssertTrue(recorded("/api/auth/oauth/finish").isEmpty)
    }

    func testClosingAuthentikIsQuiet() async {
        let (m, _) = await oauthServer()
        HTTPStub.routes(["/api/auth/oauth/start": .json(200, #"{"url":"https://auth.test/authorize"}"#)])
        await m.signInWithOAuth(using: FakeWebAuth(.failure(SignInCancelled())))
        XCTAssertNil(m.error)
    }

    func testEveryAuthentikSignInGetsAFreshKey() async throws {
        let (m, _) = await oauthServer()
        HTTPStub.routes(["/api/auth/oauth/start": .json(200, #"{"url":"https://auth.test/authorize"}"#)])
        await m.signInWithOAuth(using: FakeWebAuth(.failure(SignInCancelled())))
        await m.signInWithOAuth(using: FakeWebAuth(.failure(SignInCancelled())))
        let keys = recorded("/api/auth/oauth/start").compactMap { $0.json?["appKey"] as? String }
        XCTAssertEqual(keys.count, 2)
        XCTAssertNotEqual(keys[0], keys[1])
    }
}

@MainActor
private final class FakePasskeys: PasskeyAuthorizer {
    let result: Result<PasskeyAssertion, Error>
    var asked: (challenge: Data, relyingParty: String)?
    init(_ result: Result<PasskeyAssertion, Error>) { self.result = result }
    func assert(challenge: Data, relyingParty: String) async throws -> PasskeyAssertion {
        asked = (challenge, relyingParty)
        return try result.get()
    }
}

@MainActor
private final class FakeWebAuth: WebAuthSession {
    let result: Result<URL, Error>
    var opened: (url: URL, scheme: String)?
    init(_ result: Result<URL, Error>) { self.result = result }
    func open(_ url: URL, callbackScheme: String) async throws -> URL {
        opened = (url, callbackScheme)
        return try result.get()
    }
}
