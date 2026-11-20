import XCTest
@testable import ByteSizeKit

final class AuthServiceTests: XCTestCase {
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { nil }, session: HTTPStub.session)

    static let userJSON = #"{"id":1,"username":"alex","displayName":"Alex","email":"c@x.com","isAdmin":true,"theme":"harbor","colorMode":"light","units":"imperial","timezone":"America/Denver","setupDone":true}"#

    func testLoginBody() async throws {
        HTTPStub.routes(["/api/auth/login": .json(200, #"{"token":"abc","user":\#(Self.userJSON)}"#)])
        let reply = try await api.send(Auth.login(username: "alex", password: "pw"))
        XCTAssertEqual(reply.token, "abc")
        XCTAssertEqual(reply.user.username, "alex")
        XCTAssertEqual(HTTPStub.requests.first?.request.httpMethod, "POST")
        XCTAssertEqual(HTTPStub.requests.first?.json as? [String: String], ["username": "alex", "password": "pw"])
    }

    func testResetBodySignsIn() async throws {
        HTTPStub.routes(["/api/auth/reset": .json(200, #"{"token":"new","user":\#(Self.userJSON)}"#)])
        let reply = try await api.send(Auth.reset(email: "c@x.com", code: "123456", newPassword: "longpassword"))
        XCTAssertEqual(reply.token, "new")
        XCTAssertEqual(HTTPStub.requests.first?.json as? [String: String], ["email": "c@x.com", "code": "123456", "newPassword": "longpassword"])
    }

    func testForgotBody() async throws {
        HTTPStub.routes(["/api/auth/forgot": .json(200, #"{"ok":true,"message":"If that email has an account, a code is on its way."}"#)])
        let reply = try await api.send(Auth.forgot(email: "c@x.com"))
        XCTAssertEqual(reply.message, "If that email has an account, a code is on its way.")
        XCTAssertEqual(HTTPStub.requests.first?.json as? [String: String], ["email": "c@x.com"])
    }

    func testStatusDecodesNoOAuth() async throws {
        HTTPStub.routes(["/api/auth/status": .json(200, #"{"setupRequired":false,"passwords":true,"forgotPassword":true,"oauth":null}"#)])
        let options = try await api.send(Auth.status())
        XCTAssertEqual(options, SignInOptions(setupRequired: false, passwords: true, forgotPassword: true, oauth: nil))
    }

    func testStatusDecodesOAuth() async throws {
        HTTPStub.routes(["/api/auth/status": .json(200, #"{"setupRequired":false,"passwords":false,"forgotPassword":false,"oauth":{"label":"Authentik"}}"#)])
        let options = try await api.send(Auth.status())
        XCTAssertEqual(options.oauth?.label, "Authentik")
    }

    func testHealthAndMe() async throws {
        HTTPStub.routes([
            "/api/health": .json(200, #"{"ok":true,"db":true,"version":"1.4.0"}"#),
            "/api/auth/me": .json(200, #"{"user":\#(Self.userJSON)}"#),
        ])
        let health = try await api.send(Auth.health())
        XCTAssertEqual(health.version, "1.4.0")
        let me = try await api.send(Auth.me())
        XCTAssertEqual(me.user.displayName, "Alex")
        XCTAssertEqual(me.user.units, "imperial")
    }
}
