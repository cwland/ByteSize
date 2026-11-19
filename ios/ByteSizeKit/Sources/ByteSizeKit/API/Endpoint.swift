import Foundation

/// One call to the ByteSize server and the JSON it answers with.
public struct Endpoint<Response: Decodable & Sendable>: Sendable {
    public let method: String
    public let path: String
    public let query: [URLQueryItem]
    public let body: Data?
    /// A 401 from this call means "you're signed out" (false for sign-in itself, where 401 is a wrong password).
    public let signsOut: Bool

    public init(_ method: String, _ path: String, query: [URLQueryItem] = [], json: (any Encodable)? = nil, signsOut: Bool = true) {
        self.method = method
        self.path = path
        self.query = query
        self.body = json.flatMap { try? JSONEncoder().encode($0) }
        self.signsOut = signsOut
    }
}

/// For calls whose answer we don't need beyond "it worked" (e.g. `{ "ok": true }`).
public struct Empty: Codable, Equatable, Sendable {
    public init() {}
}
