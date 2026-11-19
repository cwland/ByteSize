import Foundation

public struct LoggedDays: Codable, Equatable, Sendable { public let days: [String] }
public struct EntryResponse: Codable, Equatable, Sendable { public let entry: LogEntry }
public struct EntriesResponse: Codable, Equatable, Sendable { public let entries: [LogEntry] }

/// The food log calls (routes/log.ts).
public enum LogAPI {
    public static func day(_ day: String) -> Endpoint<DayView> { Endpoint("GET", "/api/day/\(day)") }

    public static func logged(from: String, to: String) -> Endpoint<LoggedDays> {
        Endpoint("GET", "/api/days/logged", query: [URLQueryItem(name: "from", value: from), URLQueryItem(name: "to", value: to)])
    }

    struct WaterBody: Encodable { let water_ml: Int; let day: String }
    public static func water(ml: Int, day: String) -> Endpoint<EntryResponse> {
        Endpoint("POST", "/api/log", json: WaterBody(water_ml: ml, day: day))
    }

    struct PatchBody: Encodable { let quantity: Double?; let fraction: Double?; let servingIndex: Int? }
    /// Only the given fields change.
    public static func update(id: Int, quantity: Double?, fraction: Double?, servingIndex: Int?) -> Endpoint<EntryResponse> {
        Endpoint("PATCH", "/api/log/\(id)", json: PatchBody(quantity: quantity, fraction: fraction, servingIndex: servingIndex))
    }

    public static func delete(id: Int) -> Endpoint<Empty> { Endpoint("DELETE", "/api/log/\(id)") }

    /// Undo a delete (within 10 minutes): the same entry back.
    public static func restore(id: Int) -> Endpoint<EntryResponse> { Endpoint("POST", "/api/log/\(id)/restore") }

    struct MoveBody: Encodable { let ids: [Int]; let day: String; let meal: String; let copy: Bool }
    public static func move(ids: [Int], day: String, meal: Meal, copy: Bool) -> Endpoint<EntriesResponse> {
        Endpoint("POST", "/api/log/move", json: MoveBody(ids: ids, day: day, meal: meal.rawValue, copy: copy))
    }
}
