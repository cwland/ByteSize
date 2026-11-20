import Foundation

/// The person's own settings that the phone needs (GET /api/settings/me).
public struct MySettings: Codable, Equatable, Sendable {
    public let waterButtonsMl: [Int]
    public let weekStart: Int
    public let glp1On: Bool
}

public struct WeighIn: Codable, Equatable, Sendable {
    public let day: String
    public let weightKg: Double
    public let trendKg: Double?
}

public struct WeightPoint: Codable, Equatable, Sendable {
    public let day: String
    public let weightKg: Double
}

public struct WeightView: Codable, Equatable, Sendable {
    public let weighIns: [WeighIn]
    public let latest: WeightPoint?
    public let goalKg: Double?
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

    public static func weight(from: String? = nil) -> Endpoint<WeightView> {
        Endpoint("GET", "/api/weight", query: from.map { [URLQueryItem(name: "from", value: $0)] } ?? [])
    }

    struct WeightBody: Encodable { let weightKg: Double }
    public static func saveWeight(day: String, kg: Double) -> Endpoint<Empty> {
        Endpoint("PUT", "/api/weigh-ins/\(day)", json: WeightBody(weightKg: (kg * 100).rounded() / 100))
    }

    public static func deleteWeight(day: String) -> Endpoint<Empty> { Endpoint("DELETE", "/api/weigh-ins/\(day)") }

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
