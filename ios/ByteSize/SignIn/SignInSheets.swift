import AuthenticationServices
import ByteSizeKit
import UIKit

// I6: Apple's real sign-in sheets behind ByteSizeKit's protocols (the model is tested with fakes).

/// The window the sheets sit over.
@MainActor
private func keyWindow() -> ASPresentationAnchor {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
}

/// Face ID / Touch ID with a passkey saved for the server's address. Needs the Associated Domains entitlement
/// (webcredentials:<host>) and the server's apple-app-site-association naming this app (IOS_APP_ID).
@MainActor
final class PasskeySheet: NSObject, PasskeyAuthorizer, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var waiting: CheckedContinuation<PasskeyAssertion, Error>?
    private var controller: ASAuthorizationController?

    func assert(challenge: Data, relyingParty: String) async throws -> PasskeyAssertion {
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: relyingParty)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller
        return try await withCheckedThrowingContinuation { continuation in
            waiting = continuation
            controller.performRequests()
        }
    }

    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated { keyWindow() }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        MainActor.assumeIsolated {
            guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
                finish(.failure(SignInCancelled()))
                return
            }
            finish(.success(PasskeyAssertion(credentialID: credential.credentialID, clientDataJSON: credential.rawClientDataJSON,
                                             authenticatorData: credential.rawAuthenticatorData ?? Data(), signature: credential.signature ?? Data(),
                                             userID: credential.userID)))
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        MainActor.assumeIsolated {
            if (error as? ASAuthorizationError)?.code == .canceled {
                finish(.failure(SignInCancelled()))
            } else {
                finish(.failure(error))
            }
        }
    }

    private func finish(_ result: Result<PasskeyAssertion, Error>) {
        waiting?.resume(with: result)
        waiting = nil
        controller = nil
    }
}

/// The server's OAuth provider (Authentik) in Safari's sign-in sheet, coming back to bytesize://oauth.
@MainActor
final class WebSignInSheet: NSObject, WebAuthSession, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func open(_ url: URL, callbackScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { [weak self] back, error in
                MainActor.assumeIsolated { self?.session = nil }
                if let back {
                    continuation.resume(returning: back)
                } else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                    continuation.resume(throwing: SignInCancelled())
                } else {
                    continuation.resume(throwing: error ?? SignInCancelled())
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false // Authentik can remember you between sign-ins
            self.session = session
            if !session.start() { continuation.resume(throwing: SignInCancelled()) }
        }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated { keyWindow() }
    }
}
