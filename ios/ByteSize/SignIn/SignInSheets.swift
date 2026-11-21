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
        // Only plain Data crosses into the main actor (the credential object isn't Sendable)
        let result: Result<PasskeyAssertion, Error>
        if let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion {
            result = .success(PasskeyAssertion(credentialID: credential.credentialID, clientDataJSON: credential.rawClientDataJSON,
                                               authenticatorData: credential.rawAuthenticatorData ?? Data(), signature: credential.signature ?? Data(),
                                               userID: credential.userID))
        } else {
            result = .failure(SignInCancelled())
        }
        MainActor.assumeIsolated { finish(result) }
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
    private var waiting: CheckedContinuation<URL, Error>?

    func open(_ url: URL, callbackScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            waiting = continuation
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { [weak self] back, error in
                let result: Result<URL, Error>
                if let back {
                    result = .success(back)
                } else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                    result = .failure(SignInCancelled())
                } else {
                    result = .failure(error ?? SignInCancelled())
                }
                MainActor.assumeIsolated { self?.finish(result) }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false // Authentik can remember you between sign-ins
            self.session = session
            if !session.start() { finish(.failure(SignInCancelled())) }
        }
    }

    /// Resumes the caller exactly once, whichever of start()'s failure and the completion handler comes first.
    private func finish(_ result: Result<URL, Error>) {
        waiting?.resume(with: result)
        waiting = nil
        session = nil
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated { keyWindow() }
    }
}
