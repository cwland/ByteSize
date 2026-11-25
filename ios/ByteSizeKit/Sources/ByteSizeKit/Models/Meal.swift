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

    /// The meal for a time of day in the account's zone, from the person's meal times (the server's `mealFor`).
    public static func suggested(at date: Date, in zone: TimeZone, windows: MealWindows = .defaults) -> Meal {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        let parts = cal.dateComponents([.hour, .minute], from: date)
        let hhmm = String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
        if hhmm < windows.breakfast { return .breakfast }
        if hhmm < windows.lunch { return .lunch }
        if hhmm < windows.snacks { return .snacks }
        if hhmm < windows.dinner { return .dinner }
        return .snacks
    }
}
