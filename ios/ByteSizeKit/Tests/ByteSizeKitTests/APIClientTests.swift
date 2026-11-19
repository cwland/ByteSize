import XCTest
@testable import ByteSizeKit

private struct OK: Codable, Equatable, Sendable { let ok: Bool }
private struct Note: Codable, Sendable { let text: String }

/// Counts calls from the client's signed-out handler.
private actor Counter {
    var n = 0
    func bump() { n += 1 }
}

final class APIClientTests: XCTestCase {
    private let base = ServerAddress("https://h.test")!

    private func client(token: String? = "t1") -> APIClient {
        APIClient(base: base, token: { token }, session: HTTPStub.session)
    }

    override func setUp() {
        HTTPStub.requests = []
    }

    func testSendsBearerAndJSON() async throws {
        HTTPStub.handler = { _ in .json(200, #"{"ok":true}"#) }
        _ = try await client().send(Endpoint<OK>("POST", "/api/x", query: [URLQueryItem(name: "a", value: "1")], json: Note(text: "hi")))
        let sent = try XCTUnwrap(HTTPStub.requests.first)
        XCTAssertEqual(sent.request.url?.absoluteString, "https://h.test/api/x?a=1")
        XCTAssertEqual(sent.request.httpMethod, "POST")
        XCTAssertEqual(sent.request.value(forHTTPHeaderField: "Authorization"), "Bearer t1")
        XCTAssertEqual(sent.request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(sent.json?["text"] as? String, "hi")
    }

    func testNoTokenNoHeader() async throws {
        HTTPStub.handler = { _ in .json(200, #"{"ok":true}"#) }
        _ = try await client(token: nil).send(Endpoint<OK>("GET", "/api/x"))
        XCTAssertNil(HTTPStub.requests.first?.request.value(forHTTPHeaderField: "Authorization"))
    }

    func testDecodesBody() async throws {
        HTTPStub.handler = { _ in .json(200, #"{"ok":true}"#) }
        let reply = try await client().send(Endpoint<OK>("GET", "/api/x"))
        XCTAssertEqual(reply, OK(ok: true))
    }

    func test401CallsOnUnauthorizedAndThrows() async {
        HTTPStub.handler = { _ in .json(401, #"{"error":"Not logged in"}"#) }
        let api = client()
        let calls = Counter()
        await api.setOnUnauthorized { await calls.bump() }
        await assertThrows(.unauthorized("Not logged in")) { try await api.send(Endpoint<OK>("GET", "/api/day/2026-11-19")) }
        let n = await calls.n
        XCTAssertEqual(n, 1)
    }

    func test401OnSignInDoesNotSignOut() async {
        HTTPStub.handler = { _ in .json(401, #"{"error":"Wrong username or password"}"#) }
        let api = client(token: nil)
        let calls = Counter()
        await api.setOnUnauthorized { await calls.bump() }
        await assertThrows(.unauthorized("Wrong username or password")) { try await api.send(Endpoint<OK>("POST", "/api/auth/login", signsOut: false)) }
        let n = await calls.n
        XCTAssertEqual(n, 0)
    }

    func testServerErrorMessage() async {
        HTTPStub.handler = { _ in .json(409, #"{"error":"Too many keys"}"#) }
        await assertThrows(.server(status: 409, message: "Too many keys")) { try await self.client().send(Endpoint<OK>("POST", "/api/keys")) }
    }

    func testValidationUsesFirstDetail() async {
        HTTPStub.handler = { _ in .json(400, #"{"error":"Invalid request","details":[{"path":"username","message":"Enter your username"}]}"#) }
        await assertThrows(.server(status: 400, message: "Enter your username")) { try await self.client().send(Endpoint<OK>("POST", "/api/x")) }
    }

    func testNetworkFailureIsUnreachable() async {
        HTTPStub.handler = { _ in .fail(.cannotConnectToHost) }
        await assertThrows(.unreachable(host: "h.test")) { try await self.client().send(Endpoint<OK>("GET", "/api/x")) }
        XCTAssertEqual(APIError.unreachable(host: "h.test").message, "Can't reach ByteSize at h.test")
    }

    func testHTMLIsNotByteSize() async {
        HTTPStub.handler = { _ in .raw(200, contentType: "text/html", body: "<html>Sign in to Wi-Fi</html>") }
        await assertThrows(.notByteSize(host: "h.test")) { try await self.client().send(Endpoint<OK>("GET", "/api/x")) }
        XCTAssertEqual(APIError.notByteSize(host: "h.test").message, "Can't reach ByteSize at h.test")
    }

    func testProxyErrorPageIsNotByteSize() async {
        HTTPStub.handler = { _ in .raw(502, contentType: "text/html", body: "<html>Bad gateway</html>") }
        await assertThrows(.notByteSize(host: "h.test")) { try await self.client().send(Endpoint<OK>("GET", "/api/x")) }
    }

    private func assertThrows<T>(_ expected: APIError, _ body: () async throws -> T, file: StaticString = #filePath, line: UInt = #line) async {
        do {
            _ = try await body()
            XCTFail("expected \(expected)", file: file, line: line)
        } catch let error as APIError {
            XCTAssertEqual(error, expected, file: file, line: line)
        } catch {
            XCTFail("unexpected \(error)", file: file, line: line)
        }
    }
}
