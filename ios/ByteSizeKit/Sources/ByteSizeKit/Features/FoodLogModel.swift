import Foundation
import Observation

/// One meal's part of the log: its entries and the server's totals for it.
public struct MealSection: Identifiable, Equatable, Sendable {
    public let meal: Meal
    public let entries: [LogEntry]
    public let totals: MealTotals?
    public var id: String { meal.rawValue }
}

/// What the Undo toast offers after a delete.
public struct UndoOffer: Equatable, Sendable {
    public let entryId: Int
    public let name: String
}

/// The Food Log for the selected day: entries by meal, edit an amount, move or copy to another day or meal,
/// delete with Undo. Every change reloads the day from the server (which does the maths and merging).
@MainActor
@Observable
public final class FoodLogModel {
    public private(set) var undo: UndoOffer?
    public private(set) var message: String?

    private let api: APIClient
    private let dayStore: DayStore

    public init(api: APIClient, dayStore: DayStore) {
        self.api = api
        self.dayStore = dayStore
    }

    public var sections: [MealSection] {
        guard let day = dayStore.day else { return [] }
        // SPEC-07: the four meals always (each with its Add); supplements & water only when logged
        return Meal.allCases.compactMap { meal in
            let entries = day.entries.filter { $0.meal == meal }
            if entries.isEmpty { return meal.addable ? MealSection(meal: meal, entries: [], totals: nil) : nil }
            return MealSection(meal: meal, entries: entries, totals: day.totals(for: meal))
        }
    }

    /// Only what changed is sent.
    public func update(_ entry: LogEntry, quantity: Double, fraction: Double, servingIndex: Int) async {
        await write {
            _ = try await self.api.send(LogAPI.update(
                id: entry.id,
                quantity: quantity == entry.quantity ? nil : quantity,
                fraction: fraction == entry.fraction ? nil : fraction,
                servingIndex: servingIndex == entry.servingIndex ? nil : servingIndex
            ))
        }
    }

    /// L1: the amount from the wheel (whole + fraction of a unit), sent whole: unit, serving, quantity and fraction 1.
    public func update(_ entry: LogEntry, portion: PortionModel) async {
        guard portion.canLog else { return }
        await write {
            _ = try await self.api.send(LogAPI.update(id: entry.id, quantity: portion.quantity, fraction: 1, servingIndex: portion.servingIndex, unit: portion.unit))
        }
    }

    public func move(_ entry: LogEntry, to day: String, meal: Meal) async {
        await write { _ = try await self.api.send(LogAPI.move(ids: [entry.id], day: day, meal: meal, copy: false)) }
    }

    public func copy(_ entry: LogEntry, to day: String, meal: Meal) async {
        await write { _ = try await self.api.send(LogAPI.move(ids: [entry.id], day: day, meal: meal, copy: true)) }
    }

    public func delete(_ entry: LogEntry) async {
        let done = await write { _ = try await self.api.send(LogAPI.delete(id: entry.id)) }
        undo = done ? UndoOffer(entryId: entry.id, name: entry.name) : nil
    }

    public func undoDelete() async {
        guard let offer = undo else { return }
        undo = nil
        await write { _ = try await self.api.send(LogAPI.restore(id: offer.entryId)) }
    }

    public func dismissUndo() { undo = nil }
    public func clearMessage() { message = nil }

    /// Runs a change, then reloads the day. Returns whether the change worked.
    @discardableResult
    private func write(_ change: @escaping @MainActor () async throws -> Void) async -> Bool {
        var worked = true
        do {
            try await change()
            message = nil
        } catch {
            message = (error as? APIError)?.message ?? error.localizedDescription
            worked = false
        }
        await dayStore.reload()
        return worked
    }
}
