import Foundation

/// A fake server for tests: every request made through `HTTPStub.session` is answered by `HTTPStub.handler`
/// and recorded in `HTTPStub.requests` (with its body).
final class HTTPStub: URLProtocol, @unchecked Sendable {
    enum Reply: Sendable {
        case json(Int, String)
        case raw(Int, contentType: String, body: String)
        case fail(URLError.Code)
        /// Never answers (a server that's out of reach without failing fast).
        case hang
        /// Answers after a pause (to test answers arriving out of order).
        indirect case delayed(TimeInterval, Reply)
    }

    struct Recorded {
        let request: URLRequest
        let body: Data?
        var json: [String: Any]? { body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } }
    }

    // Requests can arrive on several threads at once (a store loading two things together): guard both with a lock
    private static let lock = NSLock()
    nonisolated(unsafe) private static var _handler: @Sendable (URLRequest) -> Reply = { _ in .json(404, #"{"error":"Not found"}"#) }
    nonisolated(unsafe) private static var _requests: [Recorded] = []

    /// Runs on URLSession's own threads: it must not touch main-actor state (hence @Sendable).
    static var handler: @Sendable (URLRequest) -> Reply {
        get { lock.withLock { _handler } }
        set { lock.withLock { _handler = newValue } }
    }

    static var requests: [Recorded] {
        get { lock.withLock { _requests } }
        set { lock.withLock { _requests = newValue } }
    }

    static var session: URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [HTTPStub.self]
        return URLSession(configuration: config)
    }

    /// Answers by path: `["/api/health": .json(200, "{…}")]`; anything else is a 404.
    static func routes(_ table: [String: Reply]) {
        requests = []
        handler = { table[$0.url?.path() ?? ""] ?? .json(404, #"{"error":"Not found"}"#) }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let recorded = Recorded(request: request, body: request.httpBody ?? readStream(request.httpBodyStream))
        HTTPStub.lock.withLock { HTTPStub._requests.append(recorded) }
        reply(HTTPStub.handler(request))
    }

    private func reply(_ answer: Reply) {
        switch answer {
        case .delayed(let seconds, let later):
            DispatchQueue.global().asyncAfter(deadline: .now() + seconds) { self.reply(later) }
        case .fail(let code):
            client?.urlProtocol(self, didFailWithError: URLError(code))
        case .hang:
            break
        case .json(let status, let body):
            send(status, "application/json; charset=utf-8", body)
        case .raw(let status, let type, let body):
            send(status, type, body)
        }
    }

    private func send(_ status: Int, _ type: String, _ body: String) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": type])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    private func readStream(_ stream: InputStream?) -> Data? {
        guard let stream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let n = stream.read(&buffer, maxLength: buffer.count)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }
}
