import Foundation
import Observation

/// A quick meal before it's logged: its items, each with its amount (changeable on the wheel) and a check mark to
/// leave it out. Log all logs the checked items to the day being looked at, one entry each (POST /api/log/meal).
@MainActor
@Observable
public final class QuickMealModel {
    public struct Row: Identifiable {
        public let id: Int
        public let item: MealItem
        public var included: Bool
        public var portion: PortionModel
    }

    public let food: Food
    public var meal: Meal
    public var rows: [Row] = []
    public private(set) var loaded = false
    public private(set) var logging = false
    public private(set) var message: String?

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let dayStore: DayStore

    public init(api: APIClient, dayStore: DayStore, food: Food, meal: Meal) {
        self.api = api
        self.dayStore = dayStore
        self.food = food
        self.meal = meal
    }

    public func load() async {
        do {
            let detail = try await api.send(MyFoodsAPI.detail(id: food.id))
            rows = (detail.food.items ?? []).enumerated().map { i, item in
                Row(id: i, item: item, included: true, portion: PortionModel(item: item, meal: meal))
            }
            message = nil
        } catch {
            message = (error as? APIError)?.message ?? error.localizedDescription
        }
        loaded = true
    }

    public func toggle(_ id: Int) {
        guard let i = rows.firstIndex(where: { $0.id == id }) else { return }
        rows[i].included.toggle()
    }

    public var totalCalories: Int { rows.filter(\.included).reduce(0) { $0 + ($1.portion.previewCalories ?? 0) } }

    public var canLog: Bool {
        let chosen = rows.filter(\.included)
        return !chosen.isEmpty && chosen.allSatisfy(\.portion.canLog) && !logging
    }

    public func logAll() async -> Bool {
        guard canLog else { return false }
        logging = true
        defer { logging = false }
        let items = rows.filter(\.included).map { row in
            MealItemBody(food: row.item.food, servingIndex: row.portion.servingIndex, unit: row.portion.unit.rawValue, quantity: row.portion.quantity, fraction: 1)
        }
        do {
            _ = try await api.send(MyFoodsAPI.logMeal(foodId: food.id, day: dayStore.selected, meal: meal, items: items))
            message = nil
            await dayStore.reload()
            return true
        } catch {
            message = (error as? APIError)?.message ?? error.localizedDescription
            return false
        }
    }
}
