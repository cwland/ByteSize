import Foundation

/// What went wrong talking to the server, with a message fit to show the person.
public enum APIError: Error, Equatable, Sendable {
    /// Signed out (or, for sign-in, the wrong username or password): the server's own words.
    case unauthorized(String)
    /// The server said no: its own words (the first field problem for a validation error).
    case server(status: Int, message: String)
    /// No answer at all (offline, wrong address, server down).
    case unreachable(host: String)
    /// Something answered, but not ByteSize (a Wi-Fi sign-in page, a proxy error page).
    case notByteSize(host: String)
    /// An AI call (photo, estimate) ran past its long wait: the server is there, the AI was slow.
    case aiTimedOut

    public var message: String {
        switch self {
        case .unauthorized(let m), .server(_, let m): m
        case .unreachable(let host), .notByteSize(let host): "Can't reach ByteSize at \(host)"
        case .aiTimedOut: "The AI took too long — try again"
        }
    }
}

/// The server's error body: `{ "error": "…", "details": [{ "path": "…", "message": "…" }] }`.
struct ServerErrorBody: Decodable {
    struct Detail: Decodable { let message: String }
    let error: String
    let details: [Detail]?

    var bestMessage: String { details?.first?.message ?? error }
}
