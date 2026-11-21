import Foundation
import Observation

/// A quick meal before it's logged: its items, each with its amount (changeable on the wheel) and a check mark to
/// leave it out. Log all logs the checked items to the day being looked at, one entry each (POST /api/log/meal).
@MainActor
@Observable
public final class QuickMealModel {
    @MainActor
    public struct Row: Identifiable {
        public let id: Int
        public let item: MealItem
        public var included: Bool
        public var portion: PortionModel
        /// Where the wheel started: an untouched amount is sent exactly as saved (the wheel rounds to eighths and thirds).
        let startWhole: Int
        let startFraction: Double
        let startChoice: UnitChoice

        init(id: Int, item: MealItem, meal: Meal) {
            self.id = id
            self.item = item
            included = true
            portion = PortionModel(item: item, meal: meal)
            startWhole = portion.whole
            startFraction = portion.fraction
            startChoice = portion.choice
        }

        public var edited: Bool { portion.whole != startWhole || portion.fraction != startFraction || portion.choice != startChoice }

        var body: MealItemBody {
            edited
                ? MealItemBody(food: item.food, servingIndex: portion.servingIndex, unit: portion.unit.rawValue, quantity: portion.quantity, fraction: 1)
                : MealItemBody(food: item.food, servingIndex: item.servingIndex, unit: item.unit, quantity: item.quantity, fraction: item.fraction)
        }
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
                Row(id: i, item: item, meal: meal)
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

    /// Untouched items count as saved; changed ones as the wheel now says.
    public var totalCalories: Int {
        rows.filter(\.included).reduce(0) { $0 + ($1.edited ? ($1.portion.previewCalories ?? 0) : Int($1.item.nutrients["calories"].rounded())) }
    }

    public var canLog: Bool {
        let chosen = rows.filter(\.included)
        return !chosen.isEmpty && chosen.allSatisfy { !$0.edited || $0.portion.canLog } && !logging
    }

    public func logAll() async -> Bool {
        guard canLog else { return false }
        logging = true
        defer { logging = false }
        let items = rows.filter(\.included).map(\.body)
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
