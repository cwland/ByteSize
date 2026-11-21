import Foundation
import Observation

/// Apple Health → ByteSize (I5, reading only): the Profile switches, and a sync that reads each switched-on kind's
/// window from Health and sends it to the server, which keeps the rules (a weigh-in only fills an empty, never-deleted
/// day; a Health workout is added once and never changed). Switches and last-synced times are saved per account.
@MainActor
@Observable
public final class HealthSync {
    public static let refused = "Allow ByteSize in the Health app: Sharing › Apps › ByteSize"

    public private(set) var syncing = false
    public private(set) var message: String?
    /// What the last sync added: "1 weigh-in, steps for 7 days, 2 workouts", or "Up to date".
    public private(set) var result: String?
    private var on: Set<HealthKind> = []
    private var last: [HealthKind: Date] = [:]

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let dayStore: DayStore
    @ObservationIgnored private let store: HealthStore
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let account: String
    @ObservationIgnored private let now: () -> Date

    /// A type's first sync reads this many days (today included); later ones start 2 days before the last sync.
    static let firstDays = 30
    static let lateDays = 2
    static let stepDays = 7

    /// `account`: who these switches belong to (server and user), so another sign-in starts with them off.
    public init(api: APIClient, dayStore: DayStore, store: HealthStore, defaults: UserDefaults = .standard, account: String, now: @escaping () -> Date = Date.init) {
        self.api = api
        self.dayStore = dayStore
        self.store = store
        self.defaults = defaults
        self.account = account
        self.now = now
        defaults.set(account, forKey: Self.lastAccountKey)
        for kind in HealthKind.allCases {
            if defaults.bool(forKey: key("on", kind)) { on.insert(kind) }
            let t = defaults.double(forKey: key("last", kind))
            if t > 0 { last[kind] = Date(timeIntervalSince1970: t) }
        }
    }

    public func isOn(_ kind: HealthKind) -> Bool { on.contains(kind) }

    // MARK: - For a cold background launch (no screens yet)

    static let lastAccountKey = "health.lastAccount"
    /// The account the app last ran Health for.
    public static func lastAccount(_ defaults: UserDefaults) -> String? { defaults.string(forKey: lastAccountKey) }
    /// The kinds switched on for an account, as saved.
    public static func savedOn(account: String, defaults: UserDefaults) -> [HealthKind] {
        HealthKind.allCases.filter { defaults.bool(forKey: "health.\(account).on.\($0.rawValue)") }
    }

    /// The latest sync of the kinds that are on.
    public var lastSynced: Date? { HealthKind.allCases.filter(isOn).compactMap { last[$0] }.max() }
    public func lastSynced(for kind: HealthKind) -> Date? { last[kind] }
    public var anyOn: Bool { !on.isEmpty }

    /// On: ask Health for that kind, then sync. Off: stop reading it.
    public func setOn(_ kind: HealthKind, _ value: Bool) async {
        if value {
            do {
                try await store.requestAccess(kind)
            } catch {
                message = Self.refused
                return
            }
            on.insert(kind)
            defaults.set(true, forKey: key("on", kind))
            await syncNow()
        } else {
            on.remove(kind)
            defaults.set(false, forKey: key("on", kind))
        }
    }

    public func clearMessage() { message = nil }

    public func syncNow() async {
        guard !syncing, !on.isEmpty else { return }
        syncing = true
        defer { syncing = false }
        var weighIns = 0, stepDays = 0, workouts = 0
        var problems: [String] = []
        for kind in HealthKind.allCases where on.contains(kind) {
            let started = now()
            do {
                switch kind {
                case .weight: weighIns = try await syncWeight()
                case .steps: stepDays = try await syncSteps()
                case .workouts: workouts = try await syncWorkouts()
                }
                last[kind] = started
                defaults.set(started.timeIntervalSince1970, forKey: key("last", kind))
            } catch {
                let why = (error as? APIError)?.message ?? "Health couldn't be read (is the phone locked?)"
                problems.append("Couldn't sync \(kind.title.lowercased()): \(why)")
            }
        }
        var parts: [String] = []
        if weighIns > 0 { parts.append(weighIns == 1 ? "1 weigh-in" : "\(weighIns) weigh-ins") }
        if stepDays > 0 { parts.append(stepDays == 1 ? "steps for 1 day" : "steps for \(stepDays) days") }
        if workouts > 0 { parts.append(workouts == 1 ? "1 workout" : "\(workouts) workouts") }
        result = parts.isEmpty ? "Up to date" : parts.joined(separator: ", ")
        message = problems.isEmpty ? nil : problems.joined(separator: "\n")
    }

    // MARK: - Each kind

    /// The first reading of each day, sent oldest first; returns how many the server added.
    private func syncWeight() async throws -> Int {
        let today = dayStore.today
        // The server takes 30–350 kg; anything else (a child or a bag on the scale) is left out
        let readings = try await store.weights(from: windowStart(.weight), to: now()).filter { !$0.fromByteSize && (30...350).contains($0.kg) }
        var firstOfDay: [String: HealthWeight] = [:]
        for r in readings {
            let day = DayMath.string(r.date, in: dayStore.zone)
            guard day <= today else { continue }
            if let have = firstOfDay[day], have.date <= r.date { continue }
            firstOfDay[day] = r
        }
        var added = 0
        for day in firstOfDay.keys.sorted() {
            guard stillOn(.weight) else { break }
            if let answer = try await sendOne(BodyAPI.saveWeight(day: day, kg: firstOfDay[day]!.kg, source: "health")), answer.skipped != true { added += 1 }
        }
        return added
    }

    private func syncSteps() async throws -> Int {
        let today = dayStore.today
        let days = try await store.dailySteps(from: windowStart(.steps), to: now(), zone: dayStore.zone)
        var sent = 0
        for (day, steps) in days.sorted(by: { $0.key < $1.key }) where steps > 0 && day <= today {
            guard stillOn(.steps) else { break }
            if try await sendOne(ActivityAPI.healthSteps(day: day, steps: steps)) != nil { sent += 1 }
        }
        return sent
    }

    private func syncWorkouts() async throws -> Int {
        let today = dayStore.today
        let list = try await store.workouts(from: windowStart(.workouts), to: now()).filter { !$0.fromByteSize }
        var added = 0
        for w in list.sorted(by: { $0.start < $1.start }) {
            let day = DayMath.string(w.start, in: dayStore.zone)
            guard day <= today else { continue }
            guard stillOn(.workouts) else { break }
            if let answer = try await sendOne(ActivityAPI.healthWorkout(w, day: day)), answer.skipped != true { added += 1 }
        }
        return added
    }

    /// Sends one item. One the server refuses as invalid (a 4xx other than signed-out) is skipped (nil) so it can't
    /// stop everything after it on every sync; anything else (offline, server down) stops the kind's sync.
    private func sendOne<R>(_ endpoint: Endpoint<R>) async throws -> R? {
        do {
            return try await api.send(endpoint)
        } catch APIError.server(let status, _) where (400..<500).contains(status) {
            return nil
        }
    }

    /// Still switched on? Read from the saved switch, which the Profile and a background sync share, so turning it off
    /// anywhere stops a sync already sending.
    private func stillOn(_ kind: HealthKind) -> Bool {
        let saved = defaults.bool(forKey: key("on", kind))
        if !saved { on.remove(kind) }
        return saved
    }

    // MARK: - Windows

    /// The start of the first day to read: 30 days on a kind's first sync; later 2 days before its last sync
    /// (steps: the last 7 days).
    private func windowStart(_ kind: HealthKind) -> Date {
        let today = dayStore.today
        let day: String
        if let previous = last[kind] {
            day = kind == .steps
                ? DayMath.add(-(Self.stepDays - 1), to: today)
                : DayMath.add(-Self.lateDays, to: DayMath.string(previous, in: dayStore.zone))
        } else {
            day = DayMath.add(-(Self.firstDays - 1), to: today)
        }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = dayStore.zone
        let p = day.split(separator: "-").compactMap { Int($0) }
        return cal.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) ?? now()
    }

    private func key(_ what: String, _ kind: HealthKind) -> String { "health.\(account).\(what).\(kind.rawValue)" }
}
