import Foundation
import Observation

/// Profile › Settings: units, week start, date format and meal times. Each change is saved to the server at once
/// (the same settings the web edits); if the server says no, the old value comes back with its message.
@MainActor
@Observable
public final class AccountSettingsModel {
    /// nil until loaded: the controls stay disabled until then.
    public private(set) var settings: MySettings?
    public private(set) var units: Units
    public private(set) var saving = false
    public var message: String?

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let dayStore: DayStore
    @ObservationIgnored private let session: SessionStore

    public init(api: APIClient, dayStore: DayStore, session: SessionStore) {
        self.api = api
        self.dayStore = dayStore
        self.session = session
        if case .signedIn(let user) = session.state { units = Units(user.units) } else { units = .imperial }
    }

    public var dateFormat: DateFormat { DateFormat(key: settings?.dateFormat) }

    public func load() async {
        do {
            let loaded = try await api.send(BodyAPI.settings())
            settings = loaded
            apply(loaded)
            message = nil
        } catch {
            message = Self.text(error)
        }
        if case .signedIn(let user) = session.state { units = Units(user.units) }
    }

    /// Back in the app: what may have changed on the web since — the settings, and the account (units).
    /// A changed account is handed to the session, which makes the app's models afresh.
    public func refresh() async {
        await load()
        guard let me = try? await api.send(Auth.me()), case .signedIn(let current) = session.state, me.user != current else { return }
        session.update(me.user)
        units = Units(me.user.units)
    }

    public func clearMessage() { message = nil }

    public func setWeekStart(_ day: Int) async { await save { $0.weekStart = day } }
    public func setDateFormat(_ format: DateFormat) async { await save { $0.dateFormat = format.rawValue } }
    public func setMealWindows(_ windows: MealWindows) async { await save { $0.mealWindows = windows } }
    public func resetMealWindows() async { await setMealWindows(.defaults) }

    public func setUnits(_ new: Units) async {
        guard new != units else { return }
        let old = units
        units = new
        saving = true
        defer { saving = false }
        do {
            let r = try await api.send(BodyAPI.saveUnits(new))
            message = nil
            session.update(r.user)
        } catch {
            units = old
            message = Self.text(error)
        }
    }

    /// Shows the change at once, sends all the settings with it, and puts the old ones back if it fails.
    private func save(_ change: (inout MySettings) -> Void) async {
        guard let old = settings else { return }
        var new = old
        change(&new)
        guard new != old else { return }
        settings = new
        saving = true
        defer { saving = false }
        do {
            let saved = try await api.send(BodyAPI.saveSettings(.init(new)))
            settings = saved
            apply(saved)
            message = nil
        } catch {
            settings = old
            message = Self.text(error)
        }
    }

    private func apply(_ s: MySettings) {
        dayStore.weekStart = s.weekStart
        dayStore.mealWindows = s.mealWindows
        dayStore.dateFormat = DateFormat(key: s.dateFormat)
    }

    private static func text(_ error: Error) -> String { (error as? APIError)?.message ?? error.localizedDescription }
}
