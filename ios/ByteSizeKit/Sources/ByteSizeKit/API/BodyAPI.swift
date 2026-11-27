import Foundation

/// The person's own settings that the phone needs (GET /api/settings/me).
public struct MySettings: Codable, Equatable, Sendable {
    public var mealWindows: MealWindows
    public var waterButtonsMl: [Int]
    public var weekStart: Int
    /// A key of DateFormat; nil = the default look.
    public var dateFormat: String?
    public var glp1On: Bool

    private enum CodingKeys: String, CodingKey { case mealWindows, waterButtonsMl, weekStart, dateFormat, glp1On }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mealWindows = (try? c.decodeIfPresent(MealWindows.self, forKey: .mealWindows)) ?? .defaults // missing or partial: the defaults
        waterButtonsMl = try c.decode([Int].self, forKey: .waterButtonsMl)
        weekStart = try c.decode(Int.self, forKey: .weekStart)
        dateFormat = try c.decodeIfPresent(String.self, forKey: .dateFormat)
        glp1On = try c.decodeIfPresent(Bool.self, forKey: .glp1On) ?? false
    }
}

public struct WeighIn: Codable, Equatable, Sendable {
    public let day: String
    public let weightKg: Double
    public let trendKg: Double?
    public let note: String?
    /// "manual" (typed) or "health" (from Apple Health); nil = unknown, or a server from before 0.19.0
    public let source: String?
}

public struct WeightPoint: Codable, Equatable, Sendable {
    public let day: String
    public let weightKg: Double
}

public struct WeightView: Codable, Equatable, Sendable {
    public let weighIns: [WeighIn]
    public let latest: WeightPoint?
    public let goalKg: Double?
    public let start: WeightPoint?
    public let trendKg: Double?
    /// Lost so far by the scale (first − latest weigh-in)
    public let lostKg: Double?
    /// Lost so far by the trend (first weigh-in − latest trend); older servers don't send it
    public let lostTrendKg: Double?
    public let goalDate: GoalDateView?
}

/// When the trend reaches the goal weight: `date` when the status is "ok".
public struct GoalDateView: Codable, Equatable, Sendable {
    public let status: String
    public let date: String?
}

public struct Shot: Codable, Equatable, Sendable {
    public let day: String
    public let medication: String
    public let doseMg: Double
    /// "mg", "units" or "ml" (servers before 0.2 don't send it: mg)
    public let doseUnit: String?
    public let site: String
    public let note: String?

    /// "7.5 mg", "25 units"
    public var doseText: String {
        "\(doseMg.rounded() == doseMg ? String(Int(doseMg)) : String(doseMg)) \(doseUnit ?? "mg")"
    }
}

public struct Glp1Settings: Codable, Equatable, Sendable {
    public let medication: String
    public let doseMg: Double
    public let doseUnit: String?
    public let injectionWeekday: Int
}

/// A standard GLP-1 medication and its dose steps (mg), as the server lists them (W1).
public struct Glp1Medication: Codable, Equatable, Sendable {
    public let name: String
    public let ingredient: String
    public let doses: [Double]
}

/// GET /api/glp1: status is none / upcoming / due / overdue.
public struct Glp1View: Codable, Equatable, Sendable {
    public let settings: Glp1Settings?
    public let lastShot: Shot?
    public let nextDue: String?
    public let status: String
    public let overdueDays: Int
    public let suggestedSite: String
    /// Recent shots, newest first.
    public let shots: [Shot]?
    public let medications: [Glp1Medication]?
}

public struct BadgeItem: Codable, Equatable, Sendable {
    public let id: String
    public let earnedOn: String?
}

public struct BadgesView: Codable, Equatable, Sendable { public let badges: [BadgeItem] }

public struct SavedLayout: Codable, Equatable, Sendable {
    public let version: Int
    public let columns: [[String]]
}

public struct LayoutResponse: Codable, Equatable, Sendable { public let layout: SavedLayout? }

/// Weight, shots, badges, settings and the phone's Dashboard layout.
public enum BodyAPI {
    public static func settings() -> Endpoint<MySettings> { Endpoint("GET", "/api/settings/me") }

    /// PUT /api/settings/me needs every one of these each time (the phone sends the saved ones with one changed).
    public struct SettingsBody: Encodable, Sendable {
        public let mealWindows: MealWindows
        public let waterButtonsMl: [Int]
        public let weekStart: Int
        public let dateFormat: String
        public init(_ s: MySettings) {
            mealWindows = s.mealWindows
            waterButtonsMl = s.waterButtonsMl
            weekStart = s.weekStart
            dateFormat = DateFormat(key: s.dateFormat).rawValue
        }
    }
    public static func saveSettings(_ body: SettingsBody) -> Endpoint<MySettings> { Endpoint("PUT", "/api/settings/me", json: body) }

    public struct ProfileResponse: Decodable, Sendable { public let user: User }
    struct UnitsBody: Encodable { let units: String }
    /// The account's units live on the account (PATCH /api/profile), not in the settings.
    public static func saveUnits(_ units: Units) -> Endpoint<ProfileResponse> {
        Endpoint("PATCH", "/api/profile", json: UnitsBody(units: units == .metric ? "metric" : "imperial"))
    }

    public static func weight(from: String? = nil) -> Endpoint<WeightView> {
        Endpoint("GET", "/api/weight", query: from.map { [URLQueryItem(name: "from", value: $0)] } ?? [])
    }

    struct WeightBody: Encodable { let weightKg: Double; let source: String? }
    /// `source` "health": the server only fills a day with no weigh-in that was never deleted (I5).
    public static func saveWeight(day: String, kg: Double, source: String? = nil) -> Endpoint<WeighInResult> {
        Endpoint("PUT", "/api/weigh-ins/\(day)", json: WeightBody(weightKg: (kg * 100).rounded() / 100, source: source))
    }

    public static func deleteWeight(day: String) -> Endpoint<Empty> { Endpoint("DELETE", "/api/weigh-ins/\(day)") }

    struct HealthMatchItem: Encodable { let day: String; let weightKg: Double }
    struct HealthMatchBody: Encodable { let items: [HealthMatchItem] }
    public struct HealthMatchAnswer: Decodable, Sendable { public let matched: Int }
    /// The one-time match: weigh-ins of unknown source whose weight is within 0.05 kg of Health's become "health".
    public static func healthMatch(_ items: [(day: String, kg: Double)]) -> Endpoint<HealthMatchAnswer> {
        Endpoint("POST", "/api/weigh-ins/health-match", json: HealthMatchBody(items: items.map { HealthMatchItem(day: $0.day, weightKg: $0.kg) }))
    }

    public static func glp1() -> Endpoint<Glp1View> { Endpoint("GET", "/api/glp1") }

    struct ShotBody: Encodable { let site: String; let doseMg: Double?; let doseUnit: String?; let note: String? }
    /// One shot per day; an empty note clears the day's note, a left-out one keeps it.
    public static func logShot(day: String, site: String, doseMg: Double? = nil, doseUnit: String? = nil, note: String? = nil) -> Endpoint<Empty> {
        Endpoint("PUT", "/api/glp1/shots/\(day)", json: ShotBody(site: site, doseMg: doseMg, doseUnit: doseUnit, note: note))
    }

    public static func badges() -> Endpoint<BadgesView> { Endpoint("GET", "/api/badges") }

    public static func layout() -> Endpoint<LayoutResponse> { Endpoint("GET", "/api/layouts/ios") }

    struct LayoutBody: Encodable { let version: Int; let columns: [[String]] }
    public static func saveLayout(_ ids: [String]) -> Endpoint<LayoutResponse> {
        Endpoint("PUT", "/api/layouts/ios", json: LayoutBody(version: 1, columns: [ids]))
    }
}
