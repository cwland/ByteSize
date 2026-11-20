import Foundation

/// The only way the app talks to the network: JSON calls to the person's own ByteSize server, with their login.
public actor APIClient {
    public let base: ServerAddress
    private let token: @Sendable () async -> String?
    private let session: URLSession
    private var onUnauthorized: (@Sendable () async -> Void)?

    public init(
        base: ServerAddress,
        token: @escaping @Sendable () async -> String?,
        session: URLSession = .shared,
        onUnauthorized: (@Sendable () async -> Void)? = nil
    ) {
        self.base = base
        self.token = token
        self.session = session
        self.onUnauthorized = onUnauthorized
    }

    /// Called once whenever the server says the login is no longer good.
    public func setOnUnauthorized(_ handler: (@Sendable () async -> Void)?) {
        onUnauthorized = handler
    }

    public func send<R>(_ endpoint: Endpoint<R>) async throws -> R {
        var request = URLRequest(url: url(for: endpoint), timeoutInterval: endpoint.timeout)
        request.httpMethod = endpoint.method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body = endpoint.body {
            request.httpBody = body
            request.setValue(endpoint.contentType ?? "application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token = await token() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch is URLError {
            throw APIError.unreachable(host: base.host)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.notByteSize(host: base.host) }
        let isJSON = (http.value(forHTTPHeaderField: "Content-Type") ?? "").contains("json")

        if (200..<300).contains(http.statusCode) {
            // No Content (e.g. a delete): fine when the caller expects nothing back
            if http.statusCode == 204, let nothing = Empty() as? R { return nothing }
            guard isJSON, let decoded = try? JSONDecoder().decode(R.self, from: data) else {
                throw APIError.notByteSize(host: base.host)
            }
            return decoded
        }
        guard isJSON, let problem = try? JSONDecoder().decode(ServerErrorBody.self, from: data) else {
            throw APIError.notByteSize(host: base.host)
        }
        if http.statusCode == 401 {
            if endpoint.signsOut, let onUnauthorized { await onUnauthorized() }
            throw APIError.unauthorized(problem.error)
        }
        throw APIError.server(status: http.statusCode, message: problem.bestMessage)
    }

    private func url(for endpoint: Endpoint<some Any>) -> URL {
        var parts = URLComponents(url: base.url, resolvingAgainstBaseURL: false)!
        parts.path = endpoint.path
        parts.queryItems = endpoint.query.isEmpty ? nil : endpoint.query
        return parts.url!
    }
}
