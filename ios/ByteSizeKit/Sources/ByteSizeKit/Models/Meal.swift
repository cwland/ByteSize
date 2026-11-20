import Foundation

/// The five meal slots, in the order the log shows them.
public enum Meal: String, Codable, CaseIterable, Identifiable, Sendable {
    case breakfast, lunch, dinner, snacks, supplements

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .breakfast: "Breakfast"
        case .lunch: "Lunch"
        case .dinner: "Dinner"
        case .snacks: "Snacks"
        case .supplements: "Supplements & water"
        }
    }

    /// The four meals the Food Log always shows, each with its Add (SPEC-07); not supplements & water.
    public var addable: Bool { self != .supplements }

    /// The meal for a time of day, using the server's default meal windows (settings-me DEFAULT_MEAL_WINDOWS):
    /// breakfast until 10:30, lunch until 14:30, snacks until 17:00, dinner until 21:00, snacks after.
    public static func suggested(at date: Date, in zone: TimeZone) -> Meal {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        let parts = cal.dateComponents([.hour, .minute], from: date)
        let minutes = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
        switch minutes {
        case ..<630: return .breakfast
        case ..<870: return .lunch
        case ..<1020: return .snacks
        case ..<1260: return .dinner
        default: return .snacks
        }
    }
}
