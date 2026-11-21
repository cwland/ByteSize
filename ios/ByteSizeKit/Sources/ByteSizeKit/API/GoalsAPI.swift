import Foundation

/// One period of a goal (a week, a month or the whole stretch) and how far along it is.
public struct PeriodProgress: Codable, Equatable, Sendable {
    public let start: String
    public let end: String
    public let value: Double?
    public let target: Double
    /// "hit", "missed", "open" or "unjudged".
    public let status: String
}

/// How a goal is going, as the server works it out (lib/goals.ts).
public struct GoalProgress: Codable, Equatable, Sendable {
    /// "upcoming", "active", "completed", "missed" or "ended".
    public let state: String
    public let current: PeriodProgress?
    public let hit: Int
    public let done: Int
    public let of: Int?
    public let needed: Int?
    public let startKg: Double?
}

/// A goal with a start and an end (GET /api/goals).
public struct Goal: Codable, Equatable, Identifiable, Sendable {
    public let id: Int
    public let type: String
    public let name: String
    public let target: Double
    /// "week", "month" or "stretch".
    public let period: String
    public let measure: String?
    public let start: String
    public let end: String?
    public let progress: GoalProgress
}

/// The active goals (past ones aren't shown on the phone).
public struct GoalsView: Codable, Equatable, Sendable { public let active: [Goal] }
public struct TargetsResponse: Codable, Equatable, Sendable { public let targets: DayTargets? }

/// Goals and targets (routes/goals.ts, routes/body-plans.ts). Read only on the phone.
public enum GoalsAPI {
    public static func goals() -> Endpoint<GoalsView> { Endpoint("GET", "/api/goals") }
    public static func targets() -> Endpoint<TargetsResponse> { Endpoint("GET", "/api/targets") }
}
