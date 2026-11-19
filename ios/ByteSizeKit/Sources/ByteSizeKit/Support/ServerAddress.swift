import Foundation

/// The address of a ByteSize server as typed on the sign-in screen, cleaned up to scheme + host (+ port).
/// A bare host gets https; a pasted web-app link loses its path and `#/…` part.
public struct ServerAddress: Equatable, Sendable {
    public let url: URL

    public var host: String { url.host() ?? url.absoluteString }

    public init?(_ typed: String) {
        let trimmed = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains(" ") else { return nil }
        let withScheme = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard let parts = URLComponents(string: withScheme),
              let scheme = parts.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = parts.host, !host.isEmpty
        else { return nil }
        var clean = URLComponents()
        clean.scheme = scheme
        clean.host = host.lowercased()
        clean.port = parts.port
        guard let url = clean.url else { return nil }
        self.url = url
    }
}
