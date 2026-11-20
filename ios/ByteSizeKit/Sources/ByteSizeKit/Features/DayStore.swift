import Foundation
import Observation

/// Calendar days as the server writes them ("2026-11-19"), with no time of day.
public enum DayMath {
    static let utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    static func date(_ day: String) -> Date? {
        let p = day.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return utc.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))
    }

    static func string(_ date: Date, in zone: TimeZone = TimeZone(identifier: "UTC")!) -> String {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = zone
        let p = c.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", p.year ?? 0, p.month ?? 0, p.day ?? 0)
    }

    public static func add(_ days: Int, to day: String) -> String {
        guard let d = date(day), let moved = utc.date(byAdding: .day, value: days, to: d) else { return day }
        return string(moved)
    }

    /// 0 = Sunday … 6 = Saturday
    public static func weekday(_ day: String) -> Int {
        guard let d = date(day) else { return 0 }
        return utc.component(.weekday, from: d) - 1
    }

    /// For headers and strips: a Date at noon UTC of that day (safe to format in any zone's calendar).
    public static func noon(_ day: String) -> Date {
        (date(day) ?? Date()).addingTimeInterval(12 * 3600)
    }
}

/// The day the Dashboard and Food Log show: which day is selected, its data from the server, and the
/// week strip's logged days. "Today" is the account's timezone, so the phone and the web agree.
@MainActor
@Observable
public final class DayStore {
    public private(set) var selected: String
    public private(set) var day: DayView?
    public private(set) var loading = false
    public private(set) var error: String?
    public private(set) var loggedDays: Set<String> = []
    /// 0 = Sunday … 6 = Saturday (the account's setting; the Dashboard fills it in once settings load)
    public var weekStart: Int

    private let api: APIClient
    private let timeZone: TimeZone
    private let now: () -> Date
    private var latest = 0 // the newest load; older answers are dropped
    private var lastToday: String

    public init(api: APIClient, timeZone: TimeZone, weekStart: Int = 0, now: @escaping () -> Date = Date.init) {
        self.api = api
        self.timeZone = timeZone
        self.weekStart = weekStart
        self.now = now
        let start = DayMath.string(now(), in: timeZone)
        selected = start
        lastToday = start
    }

    public var today: String { DayMath.string(now(), in: timeZone) }
    public var zone: TimeZone { timeZone }
    public var isToday: Bool { selected == today }

    /// The 7 days of the week that holds `day`, starting on the account's week start.
    public func week(containing day: String) -> [String] {
        let back = (DayMath.weekday(day) - weekStart + 7) % 7
        let first = DayMath.add(-back, to: day)
        return (0..<7).map { DayMath.add($0, to: first) }
    }

    public func select(_ day: String) async {
        // DAYNIL
        selected = day
        lastToday = today
        await load()
    }

    /// When the app comes back (or a new day starts): if it was showing today and today has moved on, show the
    /// new today. A day the person chose stays put.
    public func dayMayHaveChanged() async {
        let now = today
        if selected == lastToday, now != lastToday {
            await select(now)
        }
        lastToday = now
    }

    public func reload() async { await load() }

    public func shiftWeek(_ weeks: Int) async { await select(DayMath.add(7 * weeks, to: selected)) }

    private func load() async {
        latest += 1
        let mine = latest
        let wanted = selected
        let week = week(containing: wanted)
        loading = true
        do {
            async let dayAnswer = api.send(LogAPI.day(wanted))
            async let loggedAnswer = api.send(LogAPI.logged(from: week[0], to: week[6]))
            let (d, logged) = try await (dayAnswer, loggedAnswer)
            guard mine == latest else { return }
            day = d
            loggedDays = Set(logged.days)
            error = nil
        } catch {
            guard mine == latest else { return }
            self.error = (error as? APIError)?.message ?? error.localizedDescription
        }
        loading = false
    }
}
