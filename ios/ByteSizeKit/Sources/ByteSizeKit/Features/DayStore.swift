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
    /// The day `day` belongs to: while a newly chosen day loads, the previous one stays on screen (SPEC-04).
    public private(set) var dayIsFor: String?
    /// 0 = Sunday … 6 = Saturday (the account's setting; the Dashboard fills it in once settings load)
    public var weekStart: Int
    /// When each meal ends (the account's setting; the Dashboard fills it in once settings load)
    public var mealWindows: MealWindows = .defaults
    /// How dates are written (the account's setting; the Dashboard fills it in once settings load)
    public var dateFormat: DateFormat = .default

    private let api: APIClient
    private let timeZone: TimeZone
    private let now: () -> Date
    private var latest = 0 // the newest load; older answers are dropped
    private var lastToday: String
    /// Days already loaded this session: shown at once when chosen again, then refreshed quietly.
    private var cache: [String: DayView] = [:]
    /// Windows of /api/days/logged already fetched (the server answers at most 62 days at a time).
    private var loggedWindows: [ClosedRange<String>] = []

    public init(api: APIClient, timeZone: TimeZone, weekStart: Int = 0, now: @escaping () -> Date = Date.init) {
        self.api = api
        self.timeZone = timeZone
        self.weekStart = weekStart
        self.now = now
        let start = DayMath.string(now(), in: timeZone)
        selected = start
        lastToday = start
        today = start
    }

    /// The account's today: stored and observed, so the strip and "Today" redraw when the day turns
    /// (`dayMayHaveChanged`, called when the app comes back and when the calendar day changes).
    public private(set) var today: String
    public var zone: TimeZone { timeZone }
    public var isToday: Bool { selected == today }

    /// The day strip (SPEC-03): a year back to a week ahead of today.
    public var stripDays: [String] {
        let t = today
        return (-365...7).map { DayMath.add($0, to: t) }
    }

    /// Within the strip: a year back to a week ahead (days ahead are for planning food, SPEC-17).
    public func canSelect(_ day: String) -> Bool {
        let t = today
        return day >= DayMath.add(-365, to: t) && day <= DayMath.add(7, to: t)
    }

    /// A day after today: food can be planned there, nothing else logged (SPEC-17).
    public func isFuture(_ day: String) -> Bool { day > today }
    public var selectedIsFuture: Bool { isFuture(selected) }

    /// A day changed elsewhere (a copy or move into it): don't show it from the cache again.
    public func invalidate(_ day: String) { cache[day] = nil }

    func isCached(_ day: String) -> Bool { cache[day] != nil }

    /// The logged-day dots for the window around `day` ([day−31, day+30], no further than a week ahead).
    public func loadLogged(around day: String, force: Bool = false) async {
        if !force, loggedWindows.contains(where: { $0.contains(day) }) { return }
        let from = DayMath.add(-31, to: day)
        let to = min(DayMath.add(30, to: day), DayMath.add(7, to: today))
        guard from <= to, let answer = try? await api.send(LogAPI.logged(from: from, to: to)) else { return }
        loggedWindows.append(from...to)
        loggedDays = loggedDays.filter { !(from...to).contains($0) }.union(answer.days)
    }

    /// The 7 days of the week that holds `day`, starting on the account's week start.
    public func week(containing day: String) -> [String] {
        let back = (DayMath.weekday(day) - weekStart + 7) % 7
        let first = DayMath.add(-back, to: day)
        return (0..<7).map { DayMath.add($0, to: first) }
    }

    public func select(_ day: String) async {
        guard canSelect(day) else { return }
        if day != selected, let cached = cache[day] {
            self.day = cached // shown at once, refreshed below
            dayIsFor = day
        } // otherwise the previous day stays on screen until this one arrives (no empty state between days)
        selected = day
        lastToday = today
        await load()
    }

    /// When the app comes back (or a new day starts): if it was showing today and today has moved on, show the
    /// new today. A day the person chose stays put.
    public func dayMayHaveChanged() async {
        let now = DayMath.string(self.now(), in: timeZone)
        if today != now { today = now }
        if selected == lastToday, now != lastToday {
            await select(now)
        }
        lastToday = now
    }

    /// After a change: the day and its logged dots again.
    public func reload() async { await load(forceLogged: true) }

    public func shiftWeek(_ weeks: Int) async { await select(DayMath.add(7 * weeks, to: selected)) }

    private func load(forceLogged: Bool = false) async {
        latest += 1
        let mine = latest
        let wanted = selected
        loading = true
        async let dots: Void = loadLogged(around: wanted, force: forceLogged)
        do {
            let d = try await api.send(LogAPI.day(wanted))
            cache[wanted] = d
            if mine == latest {
                day = d
                dayIsFor = wanted
                error = nil
            }
        } catch {
            if mine == latest {
                self.error = (error as? APIError)?.message ?? error.localizedDescription
                // Never show one day's entries under another day's date once it's clear the new one isn't coming
                if dayIsFor != wanted {
                    day = nil
                    dayIsFor = nil
                }
            }
        }
        await dots
        guard mine == latest else { return }
        loading = false
    }
}
