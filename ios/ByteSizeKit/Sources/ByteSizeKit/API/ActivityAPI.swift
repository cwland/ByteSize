import Foundation

/// The server's answer when the phone sends a weigh-in or a workout from Health: `skipped` when it was already there,
/// or he deleted it (I5).
public struct WeighInResult: Codable, Equatable, Sendable { public let skipped: Bool? }
public struct HealthWorkoutResult: Codable, Equatable, Sendable { public let skipped: Bool? }

/// Steps and workouts from Health (routes/activity.ts).
public enum ActivityAPI {
    struct StepsBody: Encodable { let steps: Int; var source = "health" }
    public static func healthSteps(day: String, steps: Int) -> Endpoint<Empty> {
        Endpoint("PUT", "/api/steps/\(day)", json: StepsBody(steps: steps))
    }

    struct WorkoutBody: Encodable {
        let day: String
        let type: String
        let minutes: Int
        let calories: Int?
        var source = "health"
        let externalId: String
    }
    public static func healthWorkout(_ w: HealthWorkout, day: String) -> Endpoint<HealthWorkoutResult> {
        let minutes = max(1, Int((w.seconds / 60).rounded()))
        let calories = w.activeCalories.map { Int($0.rounded()) }
        return Endpoint("POST", "/api/workouts", json: WorkoutBody(day: day, type: w.activity.serverType, minutes: minutes, calories: calories, externalId: w.id))
    }
}
