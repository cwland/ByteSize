import ByteSizeKit
import Foundation
import HealthKit

/// The real Apple Health behind HealthSync: reads weight, daily steps and workouts (I5; nothing is written).
final class HealthKitStore: HealthStore, @unchecked Sendable {
    static let shared = HealthKitStore()
    let store = HKHealthStore()
    private static let ownBundle = Bundle.main.bundleIdentifier ?? "com.cwland.bytesize"

    static func sampleType(_ kind: HealthKind) -> HKSampleType {
        switch kind {
        case .weight: HKQuantityType(.bodyMass)
        case .steps: HKQuantityType(.stepCount)
        case .workouts: HKObjectType.workoutType()
        }
    }

    func requestAccess(_ kind: HealthKind) async throws {
        guard HKHealthStore.isHealthDataAvailable() else { throw HKError(.errorHealthDataUnavailable) }
        var read: Set<HKObjectType> = [Self.sampleType(kind)]
        if kind == .workouts { read.insert(HKQuantityType(.activeEnergyBurned)) }
        try await store.requestAuthorization(toShare: [], read: read)
    }

    func weights(from: Date, to: Date) async throws -> [HealthWeight] {
        let samples = try await samples(HKQuantityType(.bodyMass), from: from, to: to)
        return samples.compactMap { $0 as? HKQuantitySample }.map {
            HealthWeight(date: $0.startDate, kg: $0.quantity.doubleValue(for: .gramUnit(with: .kilo)), fromByteSize: $0.sourceRevision.source.bundleIdentifier == Self.ownBundle)
        }
    }

    func dailySteps(from: Date, to: Date, zone: TimeZone) async throws -> [String: Int] {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        let query = HKStatisticsCollectionQueryDescriptor(
            predicate: .quantitySample(type: HKQuantityType(.stepCount), predicate: HKQuery.predicateForSamples(withStart: from, end: to)),
            options: .cumulativeSum, // Health counts iPhone and Watch once
            anchorDate: cal.startOfDay(for: from),
            intervalComponents: DateComponents(day: 1)
        )
        let collection = try await query.result(for: store)
        var out: [String: Int] = [:]
        collection.enumerateStatistics(from: from, to: to) { stats, _ in
            guard let sum = stats.sumQuantity() else { return }
            let p = cal.dateComponents([.year, .month, .day], from: stats.startDate)
            let day = String(format: "%04d-%02d-%02d", p.year ?? 0, p.month ?? 0, p.day ?? 0)
            out[day] = Int(sum.doubleValue(for: .count()).rounded())
        }
        return out
    }

    func workouts(from: Date, to: Date) async throws -> [HealthWorkout] {
        let samples = try await samples(HKObjectType.workoutType(), from: from, to: to)
        return samples.compactMap { $0 as? HKWorkout }.map { w in
            let energy = w.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie())
            return HealthWorkout(id: w.uuid.uuidString, start: w.startDate, seconds: w.duration, activeCalories: energy, activity: Self.activity(w.workoutActivityType), fromByteSize: w.sourceRevision.source.bundleIdentifier == Self.ownBundle)
        }
    }

    private func samples(_ type: HKSampleType, from: Date, to: Date) async throws -> [HKSample] {
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.sample(type: type, predicate: HKQuery.predicateForSamples(withStart: from, end: to))],
            sortDescriptors: [SortDescriptor(\.startDate)]
        )
        return try await descriptor.result(for: store)
    }

    static func activity(_ t: HKWorkoutActivityType) -> HealthActivity {
        switch t {
        case .walking: .walking
        case .running: .running
        case .cycling, .handCycling: .cycling
        case .traditionalStrengthTraining, .functionalStrengthTraining, .coreTraining: .strength
        case .swimming: .swimming
        case .hiking: .hiking
        case .yoga: .yoga
        case .highIntensityIntervalTraining: .hiit
        case .soccer, .basketball, .baseball, .softball, .volleyball, .americanFootball, .hockey, .lacrosse, .rugby,
             .tennis, .tableTennis, .badminton, .racquetball, .squash, .pickleball, .golf, .handball, .cricket:
            .sport
        default: .other
        }
    }
}
