#if DEBUG
import ByteSizeKit
import Foundation

/// A pretend ByteSize server for UI tests (launch argument -UITestStubServer). Debug builds only.
/// Username "cory" with password "pw" signs in; anything else is a wrong password.
final class StubServer: URLProtocol, @unchecked Sendable {
    static let launchArgument = "-UITestStubServer"

    static var isOn: Bool { CommandLine.arguments.contains(launchArgument) }

    static var session: URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubServer.self]
        return URLSession(configuration: config)
    }

    /// Fresh, throwaway settings for each test run.
    static var defaults: UserDefaults {
        let name = "com.cwland.bytesize.uitests"
        UserDefaults().removePersistentDomain(forName: name)
        return UserDefaults(suiteName: name)!
    }

    private static let user = #"{"id":1,"username":"cory","displayName":"Cory","email":"cory@example.com","isAdmin":true,"theme":"avocado","colorMode":"dark","units":"imperial"}"#

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let (status, body) = answer()
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    private func answer() -> (Int, String) {
        switch request.url?.path() ?? "" {
        case "/api/health":
            return (200, #"{"ok":true,"db":true,"version":"stub"}"#)
        case "/api/auth/status":
            return (200, #"{"setupRequired":false,"passwords":true,"forgotPassword":true,"oauth":null}"#)
        case "/api/auth/login":
            let sent = bodyJSON()
            if sent["username"] == "cory", sent["password"] == "pw" {
                return (200, #"{"token":"stub-token","user":\#(Self.user)}"#)
            }
            return (401, #"{"error":"Wrong username or password"}"#)
        case "/api/auth/me":
            return (200, #"{"user":\#(Self.user)}"#)
        case "/api/auth/logout":
            return (200, #"{"ok":true}"#)
        default:
            return (404, #"{"error":"Not found"}"#)
        }
    }

    private func bodyJSON() -> [String: String] {
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                data.append(buffer, count: n)
            }
        }
        return (try? JSONSerialization.jsonObject(with: data) as? [String: String]) ?? [:]
    }
}
#endif
