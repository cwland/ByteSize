import Foundation

// I6: signing in on the phone with a passkey (Apple's passkey sheet) or with the server's OAuth provider (Safari's
// sheet). The sheets are behind two small protocols so the sign-in model can be tested without them.

/// What Apple's passkey sheet hands back after Face ID / Touch ID.
public struct PasskeyAssertion: Sendable, Equatable {
    public let credentialID: Data
    public let clientDataJSON: Data
    public let authenticatorData: Data
    public let signature: Data
    public let userID: Data?

    public init(credentialID: Data, clientDataJSON: Data, authenticatorData: Data, signature: Data, userID: Data?) {
        self.credentialID = credentialID
        self.clientDataJSON = clientDataJSON
        self.authenticatorData = authenticatorData
        self.signature = signature
        self.userID = userID
    }
}

/// Apple's passkey sheet (the app's `ASAuthorizationController`), or a fake in tests.
@MainActor
public protocol PasskeyAuthorizer {
    func assert(challenge: Data, relyingParty: String) async throws -> PasskeyAssertion
}

/// Safari's sign-in sheet (`ASWebAuthenticationSession`), or a fake in tests: opens `url`, returns the
/// `callbackScheme://…` address the sign-in came back to.
@MainActor
public protocol WebAuthSession {
    func open(_ url: URL, callbackScheme: String) async throws -> URL
}

/// The person closed a sign-in sheet: not an error to show.
public struct SignInCancelled: Error, Sendable {
    public init() {}
}

/// The server's passkey challenge (only what the phone needs of WebAuthn's options).
public struct PasskeyOptions: Decodable, Sendable {
    public struct Options: Decodable, Sendable {
        public let challenge: String
        public let rpId: String
    }
    public let challengeId: String
    public let options: Options
}

public struct OAuthStart: Decodable, Sendable { public let url: String }

enum Base64URL {
    static func encode(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    static func decode(_ text: String) -> Data? {
        var s = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while s.count % 4 != 0 { s += "=" }
        return Data(base64Encoded: s)
    }

    /// A random secret: 32 bytes → 43 characters.
    static func randomKey() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        for i in bytes.indices { bytes[i] = UInt8.random(in: 0...255) }
        return encode(Data(bytes))
    }
}

/// The WebAuthn JSON the server's verifier reads (what a browser's `PublicKeyCredential.toJSON()` gives).
struct PasskeyResponseBody: Encodable {
    struct Inner: Encodable {
        let clientDataJSON: String
        let authenticatorData: String
        let signature: String
        let userHandle: String?
    }
    let id: String
    let rawId: String
    let type = "public-key"
    let response: Inner
    let clientExtensionResults: [String: String] = [:]
    let authenticatorAttachment = "platform"

    init(_ a: PasskeyAssertion) {
        id = Base64URL.encode(a.credentialID)
        rawId = id
        response = Inner(clientDataJSON: Base64URL.encode(a.clientDataJSON), authenticatorData: Base64URL.encode(a.authenticatorData),
                         signature: Base64URL.encode(a.signature), userHandle: a.userID.map(Base64URL.encode))
    }
}

extension Auth {
    public static func passkeyOptions() -> Endpoint<PasskeyOptions> {
        Endpoint<PasskeyOptions>("POST", "/api/passkeys/login/options", json: [String: String](), signsOut: false).withOrigin()
    }

    struct PasskeyVerifyBody: Encodable {
        let challengeId: String
        let response: PasskeyResponseBody
    }

    static func passkeyVerify(challengeId: String, assertion: PasskeyAssertion) -> Endpoint<LoginResponse> {
        Endpoint<LoginResponse>("POST", "/api/passkeys/login/verify", json: PasskeyVerifyBody(challengeId: challengeId, response: PasskeyResponseBody(assertion)), signsOut: false).withOrigin()
    }

    static func oauthStart(appKey: String) -> Endpoint<OAuthStart> {
        Endpoint<OAuthStart>("POST", "/api/auth/oauth/start", json: ["client": "ios", "appKey": appKey], signsOut: false).withOrigin()
    }

    static func oauthFinish(ticket: String, appKey: String) -> Endpoint<LoginResponse> {
        Endpoint<LoginResponse>("POST", "/api/auth/oauth/finish", json: ["ticket": ticket, "appKey": appKey], signsOut: false).withOrigin()
    }
}
