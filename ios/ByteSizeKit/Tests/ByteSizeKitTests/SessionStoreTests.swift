import XCTest
@testable import ByteSizeKit

@MainActor
final class SessionStoreTests: XCTestCase {
    private let server = ServerAddress("https://h.test")!
    private var tokens: InMemoryTokenStore!
    private var defaults: UserDefaults!
    private let userJSON = AuthServiceTests.userJSON

    override func setUp() async throws {
        tokens = InMemoryTokenStore()
        defaults = UserDefaults(suiteName: "SessionStoreTests-\(UUID().uuidString)")
        HTTPStub.requests = []
    }

    private func store() -> SessionStore {
        SessionStore(tokens: tokens, defaults: defaults, session: HTTPStub.session)
    }

    private func signedInStore() async throws -> SessionStore {
        HTTPStub.routes(["/api/auth/login": .json(200, #"{"token":"abc","user":\#(userJSON)}"#)])
        let s = store()
        try await s.signIn(server: server, username: "alex", password: "pw")
        return s
    }

    func testSignInSavesTokenServerAndUser() async throws {
        let s = try await signedInStore()
        guard case .signedIn(let user) = s.state else { return XCTFail("not signed in: \(s.state)") }
        XCTAssertEqual(user.username, "alex")
        XCTAssertEqual(tokens.read(), "abc")
        XCTAssertEqual(defaults.string(forKey: "serverAddress"), "https://h.test")
        XCTAssertEqual(s.server, server)
    }

    func testWrongPasswordStaysSignedOut() async {
        HTTPStub.routes(["/api/auth/login": .json(401, #"{"error":"Wrong username or password"}"#)])
        let s = store()
        do {
            try await s.signIn(server: server, username: "alex", password: "nope")
            XCTFail("should throw")
        } catch {
            XCTAssertEqual(error as? APIError, .unauthorized("Wrong username or password"))
        }
        XCTAssertEqual(s.state, .signedOut(notice: nil))
        XCTAssertNil(tokens.read())
    }

    func testRememberedServerLoads() {
        defaults.set("https://h.test", forKey: "serverAddress")
        XCTAssertEqual(store().server, server)
    }

    func testRestoreWithTokenCallsMe() async {
        defaults.set("https://h.test", forKey: "serverAddress")
        tokens.write("abc")
        HTTPStub.routes(["/api/auth/me": .json(200, #"{"user":\#(userJSON)}"#)])
        let s = store()
        await s.restore()
        guard case .signedIn(let user) = s.state else { return XCTFail("not signed in: \(s.state)") }
        XCTAssertEqual(user.username, "alex")
        XCTAssertEqual(HTTPStub.requests.first?.request.value(forHTTPHeaderField: "Authorization"), "Bearer abc")
    }

    func testRestoreWithoutToken() async {
        defaults.set("https://h.test", forKey: "serverAddress")
        let s = store()
        await s.restore()
        XCTAssertEqual(s.state, .signedOut(notice: nil))
        XCTAssertTrue(HTTPStub.requests.isEmpty)
    }

    func testRestoreWithRevokedToken() async {
        defaults.set("https://h.test", forKey: "serverAddress")
        tokens.write("old")
        HTTPStub.routes(["/api/auth/me": .json(401, #"{"error":"Not logged in"}"#)])
        let s = store()
        await s.restore()
        XCTAssertEqual(s.state, .signedOut(notice: "You were signed out"))
        XCTAssertNil(tokens.read())
    }

    func testRestoreOfflineUsesLastUser() async throws {
        let first = try await signedInStore()
        _ = first
        HTTPStub.handler = { _ in .fail(.notConnectedToInternet) }
        let s = store()
        await s.restore()
        guard case .signedIn(let user) = s.state else { return XCTFail("not signed in: \(s.state)") }
        XCTAssertEqual(user.username, "alex")
        XCTAssertEqual(tokens.read(), "abc")
    }

    func testRevokedTokenSignsOutWithNotice() async throws {
        let s = try await signedInStore()
        HTTPStub.routes(["/api/day/2026-11-19": .json(401, #"{"error":"Not logged in"}"#)])
        _ = try? await s.api?.send(Endpoint<Empty>("GET", "/api/day/2026-11-19"))
        XCTAssertEqual(s.state, .signedOut(notice: "You were signed out"))
        XCTAssertNil(tokens.read())
    }

    func testOldLoginCannotSignOutNewOne() async throws {
        let s = try await signedInStore()
        let old = try XCTUnwrap(s.api)
        await s.signOut()
        try await s.signIn(server: server, username: "alex", password: "pw")
        HTTPStub.routes(["/api/day/2026-11-19": .json(401, #"{"error":"Not logged in"}"#)])
        _ = try? await old.send(Endpoint<Empty>("GET", "/api/day/2026-11-19"))
        guard case .signedIn = s.state else { return XCTFail("a stale login's 401 signed out the new one") }
        XCTAssertEqual(tokens.read(), "abc")
    }

    func testUserHasTimezone() async throws {
        let s = try await signedInStore()
        guard case .signedIn(let user) = s.state else { return XCTFail() }
        XCTAssertEqual(user.timezone, "America/Denver")
    }

    func testSignOutOffline() async throws {
        let s = try await signedInStore()
        HTTPStub.handler = { _ in .fail(.notConnectedToInternet) }
        await s.signOut()
        XCTAssertEqual(s.state, .signedOut(notice: nil))
        XCTAssertNil(tokens.read())
        XCTAssertEqual(s.server, server, "the address is remembered for next time")
    }

    func testSignOutTellsServer() async throws {
        let s = try await signedInStore()
        HTTPStub.routes(["/api/auth/logout": .json(200, #"{"ok":true}"#)])
        await s.signOut()
        for _ in 0..<50 where HTTPStub.requests.isEmpty { try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertEqual(HTTPStub.requests.first?.request.url?.path(), "/api/auth/logout")
        XCTAssertEqual(HTTPStub.requests.first?.request.value(forHTTPHeaderField: "Authorization"), "Bearer abc")
    }

    func testSignOutDoesNotWaitForTheServer() async throws {
        let s = try await signedInStore()
        HTTPStub.handler = { _ in .hang }
        let started = Date()
        await s.signOut()
        XCTAssertLessThan(Date().timeIntervalSince(started), 1, "sign-out waited on the network")
        XCTAssertEqual(s.state, .signedOut(notice: nil))
        XCTAssertNil(tokens.read())
    }

    func testUpdateKeepsSignedInWithNewUser() async throws {
        let s = try await signedInStore()
        let metric = try JSONDecoder().decode(User.self, from: Data(userJSON.replacingOccurrences(of: #""units":"imperial""#, with: #""units":"metric""#).utf8))
        s.update(metric)
        guard case .signedIn(let user) = s.state else { return XCTFail("not signed in: \(s.state)") }
        XCTAssertEqual(user.units, "metric")
        // Remembered for the next launch too
        let saved = defaults.data(forKey: "lastUser").flatMap { try? JSONDecoder().decode(User.self, from: $0) }
        XCTAssertEqual(saved?.units, "metric")
    }
}
