import Foundation

/// What ByteSize reads from Apple Health (I5: reading only).
public enum HealthKind: String, CaseIterable, Sendable {
    case weight, steps, workouts

    public var title: String {
        switch self {
        case .weight: "Weight"
        case .steps: "Steps"
        case .workouts: "Workouts"
        }
    }
}

/// A Health workout's kind, as ByteSize groups them.
public enum HealthActivity: Sendable {
    case walking, running, cycling, strength, swimming, hiking, yoga, hiit, sport, other

    /// The server's workout type (lib/activity.ts WORKOUT_TYPES).
    public var serverType: String {
        switch self {
        case .walking: "walk"
        case .running: "run"
        case .cycling: "cycling"
        case .strength: "strength"
        case .swimming: "swim"
        case .hiking: "hike"
        case .yoga: "yoga"
        case .hiit: "hiit"
        case .sport: "sport"
        case .other: "other"
        }
    }
}

/// One weight reading (kg).
public struct HealthWeight: Sendable {
    public let date: Date
    public let kg: Double
    /// Written by ByteSize itself (skipped, so nothing loops).
    public let fromByteSize: Bool

    public init(date: Date, kg: Double, fromByteSize: Bool) {
        self.date = date
        self.kg = kg
        self.fromByteSize = fromByteSize
    }
}

public struct HealthWorkout: Sendable {
    /// Health's UUID: sent as the workout's externalId so it's imported once.
    public let id: String
    public let start: Date
    public let seconds: Double
    public let activeCalories: Double?
    public let activity: HealthActivity
    public let fromByteSize: Bool

    public init(id: String, start: Date, seconds: Double, activeCalories: Double?, activity: HealthActivity, fromByteSize: Bool) {
        self.id = id
        self.start = start
        self.seconds = seconds
        self.activeCalories = activeCalories
        self.activity = activity
        self.fromByteSize = fromByteSize
    }
}

/// What the app needs from HealthKit (the app has the real one; tests use a fake).
public protocol HealthStore: Sendable {
    /// Asks Health for read access to one kind; throws when Health can't be used.
    func requestAccess(_ kind: HealthKind) async throws
    func weights(from: Date, to: Date) async throws -> [HealthWeight]
    /// Each day's step total (iPhone and Watch counted once), keyed "yyyy-MM-dd" in `zone`.
    func dailySteps(from: Date, to: Date, zone: TimeZone) async throws -> [String: Int]
    func workouts(from: Date, to: Date) async throws -> [HealthWorkout]
}
