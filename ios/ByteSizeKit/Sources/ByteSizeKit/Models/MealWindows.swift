import Foundation

/// When each meal ends, as "HH:mm" in the account's time zone (GET /api/settings/me `mealWindows`).
/// Before breakfast's end → breakfast, … after dinner's end → snacks; a time on a boundary is the next meal.
public struct MealWindows: Codable, Equatable, Sendable {
    public var breakfast: String
    public var lunch: String
    public var snacks: String
    public var dinner: String

    public init(breakfast: String, lunch: String, snacks: String, dinner: String) {
        self.breakfast = breakfast
        self.lunch = lunch
        self.snacks = snacks
        self.dinner = dinner
    }

    /// The server's defaults (settings-me DEFAULT_MEAL_WINDOWS).
    public static let defaults = MealWindows(breakfast: "10:30", lunch: "14:30", snacks: "17:00", dinner: "21:00")
}
