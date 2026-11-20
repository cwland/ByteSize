import Foundation

/// The signed-in person, as the server describes them (`publicUser`).
public struct User: Codable, Equatable, Sendable {
    public let id: Int
    public let username: String
    public let displayName: String?
    public let email: String?
    public let isAdmin: Bool
    /// Web theme id; nil = the default (Avocado).
    public let theme: String?
    /// light / dark / system; nil = the app default.
    public let colorMode: String?
    /// imperial or metric.
    public let units: String
}

/// What the sign-in screen can offer (`GET /api/auth/status`).
public struct SignInOptions: Codable, Equatable, Sendable {
    public struct OAuthOption: Codable, Equatable, Sendable { public let label: String }
    public let setupRequired: Bool
    public let passwords: Bool
    public let forgotPassword: Bool
    public let oauth: OAuthOption?
}

public struct ServerHealth: Codable, Equatable, Sendable {
    public let ok: Bool
    public let version: String
}

/// Sign-in and password reset both answer with a login token and the person.
public struct LoginResponse: Codable, Equatable, Sendable {
    public let token: String
    public let user: User
}

public struct MeResponse: Codable, Equatable, Sendable {
    public let user: User
}

public struct MessageResponse: Codable, Equatable, Sendable {
    public let message: String
}

/// The sign-in and account calls.
public enum Auth {
    public static func health() -> Endpoint<ServerHealth> { Endpoint("GET", "/api/health") }
    public static func status() -> Endpoint<SignInOptions> { Endpoint("GET", "/api/auth/status") }
    public static func me() -> Endpoint<MeResponse> { Endpoint("GET", "/api/auth/me") }

    public static func login(username: String, password: String) -> Endpoint<LoginResponse> {
        Endpoint("POST", "/api/auth/login", json: ["username": username, "password": password], signsOut: false)
    }

    public static func logout() -> Endpoint<Empty> { Endpoint("POST", "/api/auth/logout", signsOut: false) }

    public static func forgot(email: String) -> Endpoint<MessageResponse> {
        Endpoint("POST", "/api/auth/forgot", json: ["email": email], signsOut: false)
    }

    public static func reset(email: String, code: String, newPassword: String) -> Endpoint<LoginResponse> {
        Endpoint("POST", "/api/auth/reset", json: ["email": email, "code": code, "newPassword": newPassword], signsOut: false)
    }
}
