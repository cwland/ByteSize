import Foundation
import Observation

/// The sign-in screen: server address first (remembered after the first time), then username and password,
/// with "Forgot password?" (an emailed 6-digit code) when the server has email set up.
@MainActor
@Observable
public final class SignInModel {
    public enum Step: Equatable, Sendable { case server, credentials }
    public enum ResetStep: Equatable, Sendable { case email, code }

    public static let badAddress = "Enter your ByteSize address, like bytesize.example.com"
    public static let needsHTTPS = "ByteSize needs your secure address, starting with https://"
    public static let notSetUp = "This ByteSize server isn't set up yet. Finish setup in the web app first."

    public var serverText = ""
    public var username = ""
    public var password = ""
    public private(set) var step: Step
    public private(set) var address: ServerAddress?
    public private(set) var options: SignInOptions?
    public private(set) var serverVersion: String?
    public private(set) var error: String?
    public private(set) var busy = false

    public var resetEmail = ""
    public var resetCode = ""
    public var newPassword = ""
    /// nil: not resetting.
    public private(set) var resetStep: ResetStep?
    public private(set) var resetNotice: String?
    public private(set) var resetError: String?

    private let session: SessionStore

    public init(session: SessionStore) {
        self.session = session
        address = session.server
        step = session.server == nil ? .server : .credentials
    }

    /// Why the person is looking at sign-in (e.g. "You were signed out").
    public var notice: String? {
        if case .signedOut(let notice) = session.state { return notice }
        return nil
    }

    public var canContinue: Bool { !serverText.trimmingCharacters(in: .whitespaces).isEmpty && !busy }
    public var canSignIn: Bool { !trimmedUsername.isEmpty && !password.isEmpty && !busy }
    public var showsPasswordForm: Bool { options?.passwords ?? true }
    public var showsForgotPassword: Bool { options?.forgotPassword ?? false }

    /// For a remembered server: fetch what it offers (Forgot password etc.).
    public func load() async {
        guard let address, options == nil else { return }
        await check(address)
    }

    public func connect() async {
        guard let typed = ServerAddress(serverText) else {
            error = Self.badAddress
            return
        }
        // iPhones refuse plain http (and it would send the login unencrypted)
        guard typed.url.scheme == "https" else {
            error = Self.needsHTTPS
            return
        }
        await check(typed)
    }

    public func changeServer() {
        serverText = address?.host ?? serverText
        step = .server
        options = nil
        serverVersion = nil
        error = nil
    }

    public func signIn() async {
        guard canSignIn, let address else { return }
        busy = true
        defer { busy = false }
        do {
            try await session.signIn(server: address, username: trimmedUsername, password: password)
            error = nil
        } catch {
            self.error = (error as? APIError)?.message ?? error.localizedDescription
            password = ""
        }
    }

    // MARK: - Forgot password

    public func startReset() {
        resetStep = .email
        resetEmail = ""
        resetCode = ""
        newPassword = ""
        resetNotice = nil
        resetError = nil
    }

    public func cancelReset() { resetStep = nil }

    public func sendCode() async {
        guard let address else { return }
        await resetCall {
            let reply = try await self.session.client(for: address).send(Auth.forgot(email: self.resetEmail.trimmingCharacters(in: .whitespaces)))
            self.resetNotice = reply.message
            self.resetStep = .code
        }
    }

    /// A good code signs the person straight in.
    public func resetPassword() async {
        guard let address else { return }
        await resetCall {
            let login = try await self.session.client(for: address).send(
                Auth.reset(email: self.resetEmail.trimmingCharacters(in: .whitespaces), code: self.resetCode.trimmingCharacters(in: .whitespaces), newPassword: self.newPassword)
            )
            self.session.adopt(login, server: address)
            self.resetStep = nil
        }
    }

    // MARK: - private

    private var trimmedUsername: String { username.trimmingCharacters(in: .whitespaces) }

    private func check(_ server: ServerAddress) async {
        busy = true
        defer { busy = false }
        do {
            let api = session.client(for: server)
            let health = try await api.send(Auth.health())
            let status = try await api.send(Auth.status())
            guard !status.setupRequired else {
                error = Self.notSetUp
                return
            }
            address = server
            serverVersion = health.version
            options = status
            step = .credentials
            if !status.passwords {
                let how = status.oauth.map { "This server signs in with \($0.label)." } ?? "This server doesn't allow password sign-in."
                error = "\(how) That's coming to the app soon — use the web app for now."
            } else {
                error = nil
            }
        } catch {
            self.error = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    private func resetCall(_ work: @escaping @MainActor () async throws -> Void) async {
        busy = true
        defer { busy = false }
        do {
            try await work()
            resetError = nil
        } catch {
            resetError = (error as? APIError)?.message ?? error.localizedDescription
        }
    }
}
