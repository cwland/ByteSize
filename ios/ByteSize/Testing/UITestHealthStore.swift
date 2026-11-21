#if DEBUG
import ByteSizeKit
import Foundation

/// A pretend Apple Health for UI tests (launch argument -UITestFakeHealth): a weigh-in of 80 kg this morning,
/// a week of steps and one run yesterday.
final class UITestHealthStore: HealthStore, @unchecked Sendable {
    static let launchArgument = "-UITestFakeHealth"
    static var isOn: Bool { CommandLine.arguments.contains(launchArgument) }

    func requestAccess(_ kind: HealthKind) async throws {}

    func weights(from: Date, to: Date) async throws -> [HealthWeight] {
        let morning = Calendar.current.date(bySettingHour: 7, minute: 0, second: 0, of: Date()) ?? Date()
        return [HealthWeight(date: min(morning, Date()), kg: 80, fromByteSize: false)]
    }

    func dailySteps(from: Date, to: Date, zone: TimeZone) async throws -> [String: Int] {
        var out: [String: Int] = [:]
        for back in 0..<7 {
            let d = Calendar.current.date(byAdding: .day, value: -back, to: Date()) ?? Date()
            let p = Calendar.current.dateComponents([.year, .month, .day], from: d)
            out[String(format: "%04d-%02d-%02d", p.year ?? 0, p.month ?? 0, p.day ?? 0)] = 6000 + back * 100
        }
        return out
    }

    func workouts(from: Date, to: Date) async throws -> [HealthWorkout] {
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date()) ?? Date()
        return [HealthWorkout(id: "UITEST-RUN", start: yesterday, seconds: 1800, activeCalories: 300, activity: .running, fromByteSize: false)]
    }
}
#endif
