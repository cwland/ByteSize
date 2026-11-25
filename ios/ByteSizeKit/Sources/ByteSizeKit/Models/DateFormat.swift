import Foundation

/// How the account writes dates (GET /api/settings/me `dateFormat`): the same ten looks, in the same order and with
/// the same English words, as the web's frontend/src/dateFormat.ts, so both apps write a day the same way.
public enum DateFormat: String, CaseIterable, Identifiable, Sendable {
    case weekdayLongMonthShort = "weekday-long-month-short" // Wednesday, Nov 18
    case weekdayShortMonthShort = "weekday-short-month-short" // Wed, Nov 18
    case weekdayLongMonthLong = "weekday-long-month-long" // Wednesday, November 18
    case mdySlash = "mdy-slash" // 11/18/2026
    case weekdayLongDayMonthShort = "weekday-long-day-month-short" // Wednesday 18 Nov
    case weekdayShortDayMonthShort = "weekday-short-day-month-short" // Wed 18 Nov
    case weekdayLongDayMonthLong = "weekday-long-day-month-long" // Wednesday 18 November
    case dmySlash = "dmy-slash" // 18/11/2026
    case dmyDot = "dmy-dot" // 18.11.2026
    case iso // 2026-11-18

    public static let `default` = DateFormat.weekdayLongMonthShort

    public var id: String { rawValue }

    /// An unknown or missing key is the default look.
    public init(key: String?) {
        self = key.flatMap(DateFormat.init(rawValue:)) ?? .default
    }

    private static let weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    private static let months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

    private struct Parts {
        let y: Int, m: Int, d: Int
        let weekday: String, month: String
    }

    private static func parts(_ day: String) -> Parts {
        let n = day.split(separator: "-").map { Int($0) ?? 0 }
        let (y, m, d) = (n.count > 0 ? n[0] : 1970, n.count > 1 ? n[1] : 1, n.count > 2 ? n[2] : 1)
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let date = cal.date(from: DateComponents(year: y, month: m, day: d)) ?? Date(timeIntervalSince1970: 0)
        let weekday = weekdays[cal.component(.weekday, from: date) - 1]
        return Parts(y: y, m: m, d: d, weekday: weekday, month: months[max(0, min(11, m - 1))])
    }

    private static func pad(_ n: Int) -> String { String(format: "%02d", n) }
    private static func short(_ s: String) -> String { String(s.prefix(3)) }

    /// "2026-11-18" with its weekday, written this way (web `formatDate`).
    public func long(_ day: String) -> String {
        let p = Self.parts(day)
        switch self {
        case .weekdayLongMonthShort: return "\(p.weekday), \(Self.short(p.month)) \(p.d)"
        case .weekdayShortMonthShort: return "\(Self.short(p.weekday)), \(Self.short(p.month)) \(p.d)"
        case .weekdayLongMonthLong: return "\(p.weekday), \(p.month) \(p.d)"
        case .mdySlash: return "\(Self.pad(p.m))/\(Self.pad(p.d))/\(p.y)"
        case .weekdayLongDayMonthShort: return "\(p.weekday) \(p.d) \(Self.short(p.month))"
        case .weekdayShortDayMonthShort: return "\(Self.short(p.weekday)) \(p.d) \(Self.short(p.month))"
        case .weekdayLongDayMonthLong: return "\(p.weekday) \(p.d) \(p.month)"
        case .dmySlash: return "\(Self.pad(p.d))/\(Self.pad(p.m))/\(p.y)"
        case .dmyDot: return "\(Self.pad(p.d)).\(Self.pad(p.m)).\(p.y)"
        case .iso: return "\(p.y)-\(Self.pad(p.m))-\(Self.pad(p.d))"
        }
    }

    /// A day without its weekday (web `formatDay`): "Apr 5", "5 April", "05/04/2027". The worded looks add the year
    /// when it isn't `today`'s year; the numeric ones always have it.
    public func short(_ day: String, today: String) -> String {
        switch self {
        case .mdySlash, .dmySlash, .dmyDot, .iso: return long(day)
        default: break
        }
        let p = Self.parts(day)
        let longMonth = self == .weekdayLongMonthLong || self == .weekdayLongDayMonthLong
        let dayFirst = self == .weekdayLongDayMonthShort || self == .weekdayShortDayMonthShort || self == .weekdayLongDayMonthLong
        let month = longMonth ? p.month : Self.short(p.month)
        let withYear = day.prefix(4) != today.prefix(4)
        if dayFirst { return withYear ? "\(p.d) \(month) \(p.y)" : "\(p.d) \(month)" }
        return withYear ? "\(month) \(p.d), \(p.y)" : "\(month) \(p.d)"
    }
}
