import Foundation
import Observation

/// Who is signed in, to which server, and the API client that goes with it.
@MainActor
@Observable
public final class SessionStore {
    public enum State: Equatable, Sendable {
        case restoring
        case signedOut(notice: String?)
        case signedIn(User)
    }

    public static let signedOutNotice = "You were signed out"

    public private(set) var state: State = .restoring
    /// The remembered server (kept after signing out, so the sign-in screen can skip the address step).
    public private(set) var server: ServerAddress?
    /// The client for the signed-in server; nil when signed out.
    public private(set) var api: APIClient?

    /// Bumped on every sign-out: a 401 from a client made before then can't sign out a newer login.
    private var generation = 0
    private let tokens: TokenStore
    private let defaults: UserDefaults
    private let session: URLSession

    private enum Key {
        static let server = "serverAddress"
        static let lastUser = "lastUser"
    }

    public init(tokens: TokenStore, defaults: UserDefaults = .standard, session: URLSession = .shared) {
        self.tokens = tokens
        self.defaults = defaults
        self.session = session
        server = defaults.string(forKey: Key.server).flatMap { ServerAddress($0) }
        // Nothing saved: straight to sign-in (no restore step to wait for)
        if server == nil || tokens.read() == nil { state = .signedOut(notice: nil) }
    }

    /// A client for any server (used before sign-in to check the address), wired to sign out on a 401.
    public func client(for server: ServerAddress) -> APIClient {
        let tokens = self.tokens
        let made = generation
        return APIClient(base: server, token: { tokens.read() }, session: session) { [weak self] in
            await self?.handleUnauthorized(from: made)
        }
    }

    /// On launch: use the saved login if there is one. Offline, the last known person is shown.
    public func restore() async {
        guard let server, tokens.read() != nil else {
            state = .signedOut(notice: nil)
            return
        }
        let api = client(for: server)
        do {
            let me = try await api.send(Auth.me())
            signedIn(me.user, api: api)
        } catch APIError.unauthorized {
            // handleUnauthorized has already signed out
        } catch let error as APIError {
            if let user = lastUser {
                signedIn(user, api: api)
            } else {
                state = .signedOut(notice: error.message)
            }
        } catch {
            state = .signedOut(notice: nil)
        }
    }

    public func signIn(server: ServerAddress, username: String, password: String) async throws {
        let api = client(for: server)
        let login = try await api.send(Auth.login(username: username, password: password))
        adopt(login, server: server, api: api)
    }

    /// Takes a fresh login (from sign-in or a password reset) and makes it this device's.
    public func adopt(_ login: LoginResponse, server: ServerAddress) {
        adopt(login, server: server, api: client(for: server))
    }

    /// Signs out on this phone at once; the server is told in the background (and if it can't be reached,
    /// the login simply expires there).
    public func signOut() async {
        let token = tokens.read()
        let server = self.server
        clear(notice: nil)
        guard let token, let server else { return }
        let tellServer = APIClient(base: server, token: { token }, session: session)
        Task.detached { _ = try? await tellServer.send(Auth.logout()) }
    }

    /// The account changed (units saved on the phone): remember it and show it everywhere.
    public func update(_ user: User) {
        guard case .signedIn = state else { return }
        defaults.set(try? JSONEncoder().encode(user), forKey: Key.lastUser)
        state = .signedIn(user)
    }

    func handleUnauthorized(from made: Int) {
        guard made == generation else { return } // an earlier login's request
        if case .signedOut = state { return }
        clear(notice: Self.signedOutNotice)
    }

    // MARK: - private

    private var lastUser: User? {
        defaults.data(forKey: Key.lastUser).flatMap { try? JSONDecoder().decode(User.self, from: $0) }
    }

    private func adopt(_ login: LoginResponse, server: ServerAddress, api: APIClient) {
        tokens.write(login.token)
        defaults.set(server.url.absoluteString, forKey: Key.server)
        self.server = server
        signedIn(login.user, api: api)
    }

    private func signedIn(_ user: User, api: APIClient) {
        defaults.set(try? JSONEncoder().encode(user), forKey: Key.lastUser)
        self.api = api
        state = .signedIn(user)
    }

    private func clear(notice: String?) {
        generation += 1
        tokens.write(nil)
        defaults.removeObject(forKey: Key.lastUser)
        api = nil
        state = .signedOut(notice: notice)
    }
}
