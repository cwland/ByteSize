import Foundation
import Observation

/// The Goals tab: today's targets, the active goals, and the weight chart and history with logging and deleting
/// weigh-ins. Everything is worked out by the server; this only cuts the weigh-ins to a range and lines them up.
@MainActor
@Observable
public final class GoalsModel {
    public enum WeightRange: String, CaseIterable, Sendable {
        case week = "1W", month = "1M", threeMonths = "3M", all = "All"

        /// Days back from today (inclusive); nil = every weigh-in.
        var days: Int? {
            switch self {
            case .week: 7
            case .month: 30
            case .threeMonths: 90
            case .all: nil
            }
        }
    }

    /// One weigh-in in the history, with its change from the one before (nil for the first) and where it came from
    /// ("health", "manual", or nil = unknown).
    public struct WeightRow: Identifiable, Equatable, Sendable {
        public let day: String
        public let weightKg: Double
        public let changeKg: Double?
        public let source: String?
        public var id: String { day }
    }

    /// A weigh-in's change pill: green ↓ loss, red ↑ gain, neutral "0.0" when it rounds to nothing.
    public enum ChangeKind: Equatable, Sendable { case loss, gain, none }
    public struct Change: Equatable, Sendable {
        public let kind: ChangeKind
        public let text: String
        public init(kind: ChangeKind, text: String) { self.kind = kind; self.text = text }
    }

    /// Lost so far as shown: never below zero ("0.0 lb"); `isLoss` (green) only when it shows more than 0.0.
    public struct Lost: Equatable, Sendable {
        public let text: String
        public let isLoss: Bool
        public init(text: String, isLoss: Bool) { self.text = text; self.isLoss = isLoss }
    }

    /// The Est. goal date row: the date (or the state in words) and the likely range under it.
    public struct GoalDateLine: Equatable, Sendable {
        public let main: String
        public let detail: String?
        public init(main: String, detail: String?) { self.main = main; self.detail = detail }
    }

    public private(set) var goals: [Goal] = []
    public private(set) var targets: DayTargets?
    public private(set) var weight: WeightView?
    public private(set) var message: String?
    public private(set) var loaded = false
    public var range: WeightRange = .month
    public let units: Units

    private let api: APIClient
    private let dayStore: DayStore
    private let weightChanged: () async -> Void

    public init(api: APIClient, dayStore: DayStore, units: Units, weightChanged: @escaping () async -> Void = {}) {
        self.api = api
        self.dayStore = dayStore
        self.units = units
        self.weightChanged = weightChanged
    }

    /// The account's today: weigh-ins can be logged for it or an earlier day.
    public var today: String { dayStore.today }

    public func load() async {
        async let g = api.send(GoalsAPI.goals())
        async let t = api.send(GoalsAPI.targets())
        async let w = api.send(BodyAPI.weight())
        do {
            let (goalsView, targetsView, weightView) = try await (g, t, w)
            goals = goalsView.active
            targets = targetsView.targets
            weight = weightView
            message = nil
        } catch {
            message = Self.text(error)
        }
        loaded = true
    }

    /// The weigh-ins in the chosen range, oldest first.
    public var chartPoints: [WeighIn] {
        let all = weight?.weighIns ?? []
        guard let days = range.days else { return all }
        let from = DayMath.add(-(days - 1), to: dayStore.today)
        return all.filter { $0.day >= from }
    }

    /// Every weigh-in, newest first, each with its change from the one before it.
    public var history: [WeightRow] {
        let all = weight?.weighIns ?? []
        return all.enumerated().map { i, w in
            WeightRow(day: w.day, weightKg: w.weightKg, changeKg: i == 0 ? nil : w.weightKg - all[i - 1].weightKg, source: w.source)
        }.reversed()
    }

    /// The newest weigh-in has its own card; the 5 before it show as Recent until "Show all" (owner's ask).
    public static let historyLimit = 5
    public var showAllHistory = false

    public var latestRow: WeightRow? { history.first }

    public var recentRows: [WeightRow] {
        let rest = Array(history.dropFirst())
        return showAllHistory ? rest : Array(rest.prefix(Self.historyLimit))
    }

    public var hiddenHistoryCount: Int { showAllHistory ? 0 : max(0, history.count - 1 - Self.historyLimit) }

    /// One decimal in the person's units, as shown
    private static func shown(_ kg: Double, _ units: Units) -> Double { (units.weightValue(kg: kg) * 10).rounded() / 10 }

    /// The pill for a change from the weigh-in before (nil: the first weigh-in has none). The rounded figure decides
    /// the color, so "0.0" is never green or red.
    public static func change(_ kg: Double?, units: Units) -> Change? {
        guard let kg else { return nil }
        let v = shown(kg, units)
        let text = "\(String(format: "%.1f", abs(v))) \(units.weightUnit)"
        return Change(kind: v < 0 ? .loss : v > 0 ? .gain : .none, text: text)
    }

    /// Lost so far (by the scale or the trend) as shown: a gain or nothing shows "0.0".
    public static func lost(_ kg: Double?, units: Units) -> Lost? {
        guard let kg else { return nil }
        let v = max(0, shown(kg, units))
        return Lost(text: "\(String(format: "%.1f", v)) \(units.weightUnit)", isLoss: v > 0)
    }

    /// The Est. goal date row (nil: no goal weight, so the row is hidden).
    public static func goalDateLine(_ g: GoalDateView?, format: DateFormat, today: String) -> GoalDateLine? {
        guard let g else { return nil }
        switch g.status {
        case "ok":
            guard let date = g.date else { return nil }
            var detail: String?
            if let from = g.earliest, let to = g.latest {
                // The first date drops its year when it shares the second's
                detail = "Between \(format.short(from, today: to)) and \(format.short(to, today: today))"
            }
            return GoalDateLine(main: format.short(date, today: today), detail: detail)
        case "reached": return GoalDateLine(main: "Goal reached", detail: nil)
        case "not_enough": return GoalDateLine(main: "Not enough weigh-ins yet", detail: nil)
        case "not_losing": return GoalDateLine(main: "Not losing at the moment", detail: nil)
        default: return nil
        }
    }

    /// A weigh-in typed in the account's units, for today or an earlier day.
    public func logWeight(display: Double, day: String) async throws {
        guard day <= dayStore.today else { throw APIError.server(status: 400, message: "Choose today or an earlier day") }
        _ = try await api.send(BodyAPI.saveWeight(day: day, kg: units.kg(fromDisplay: display)))
        await afterWeightChange()
    }

    public func deleteWeighIn(day: String) async {
        do {
            _ = try await api.send(BodyAPI.deleteWeight(day: day))
            message = nil
        } catch {
            message = Self.text(error)
        }
        await afterWeightChange()
    }

    public func clearMessage() { message = nil }

    private func afterWeightChange() async {
        if let w = try? await api.send(BodyAPI.weight()) { weight = w }
        await weightChanged()
    }

    private static func text(_ error: Error) -> String { (error as? APIError)?.message ?? error.localizedDescription }

    // MARK: - Words

    private static let dayCountTypes: [String: String] = [
        "logging_days": "days", "protein_days": "days", "calorie_days": "days", "water_days": "days",
        "fiber_days": "days", "weigh_ins": "weigh-ins", "workouts": "workouts", "active_minutes": "minutes",
    ]

    /// The goal's current progress in words: "3 of 5 days this week", "Reach 165.3 lb by Dec 31", "Starts Tue, Dec 1".
    public static func progressText(_ g: Goal, units: Units) -> String {
        if g.progress.state == "upcoming" { return "Starts \(format(g.start, "EEEMMMd"))" }
        if g.type == "weight_by_date" {
            let by = g.end.map { " by \(format($0, "MMMd"))" } ?? ""
            return "Reach \(units.weight(kg: g.target))\(by)"
        }
        let current = g.progress.current
        let value = current?.value ?? 0
        let target = current?.target ?? g.target
        let noun = g.type == "steps" ? (g.measure == "average" ? "steps a day" : "steps") : g.type == "streak" ? "days in a row" : (dayCountTypes[g.type] ?? "")
        let when = g.period == "week" ? "this week" : g.period == "month" ? "this month" : "so far"
        return "\(number(value)) of \(number(target)) \(noun) \(when)"
    }

    /// The whole goal: "2 of 4 needed (5 weeks)"; nil for a goal with no end.
    public static func overallText(_ g: Goal) -> String? {
        guard let needed = g.progress.needed, let of = g.progress.of, g.period != "stretch" else { return nil }
        let unit = g.period == "week" ? (of == 1 ? "week" : "weeks") : (of == 1 ? "month" : "months")
        return "\(g.progress.hit) of \(needed) needed (\(of) \(unit))"
    }

    private static func number(_ v: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 1
        f.locale = Locale(identifier: "en_US")
        return f.string(from: NSNumber(value: v)) ?? "\(v)"
    }

    private static func format(_ day: String, _ template: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.timeZone = TimeZone(identifier: "UTC")
        f.setLocalizedDateFormatFromTemplate(template)
        return f.string(from: DayMath.noon(day))
    }
}
