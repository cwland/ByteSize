import Foundation

/// A target range (targets are ranges, not caps).
public struct TargetRange: Codable, Equatable, Sendable {
    public let min: Double
    public let max: Double
    public init(min: Double, max: Double) {
        self.min = min
        self.max = max
    }
}

/// The targets in force on a day (calories include the day's workout calories when the plan adds them).
public struct DayTargets: Codable, Equatable, Sendable {
    public let calories: TargetRange
    public let protein_g: TargetRange
    public let fiber_g: TargetRange
    public let water_ml: TargetRange
}

public struct MealTotals: Codable, Equatable, Sendable {
    public let calories: Double
    public let protein_g: Double
    public let carbs_g: Double
    public let fat_g: Double
    public let fiber_g: Double
}

/// GET /api/day/:date — everything the Dashboard and Food Log show for a day, worked out by the server.
public struct DayView: Codable, Equatable, Sendable {
    public let day: String
    public let entries: [LogEntry]
    public let totals: Nutrients
    public let meals: [String: MealTotals]
    public let targets: DayTargets?
    public let streak: Int

    public func totals(for meal: Meal) -> MealTotals? { meals[meal.rawValue] }
}
