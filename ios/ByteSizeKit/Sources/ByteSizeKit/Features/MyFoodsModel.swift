import Foundation
import Observation

/// The My Foods tab: the person's custom foods, corrections, recipes and quick meals, searched, filtered and sorted
/// by the server; a food is logged to the day being looked at.
@MainActor
@Observable
public final class MyFoodsModel {
    public enum Filter: CaseIterable, Sendable {
        case all, foods, edits, recipes, meals

        public var title: String {
            switch self {
            case .all: "All"
            case .foods: "Foods"
            case .edits: "My edits"
            case .recipes: "Recipes"
            case .meals: "Quick meals"
            }
        }

        /// The server has no "corrections" kind: My edits asks for foods and keeps the overrides.
        var serverKind: String {
            switch self {
            case .all: "all"
            case .foods, .edits: "foods"
            case .recipes: "recipes"
            case .meals: "meals"
            }
        }

        func keeps(_ food: Food) -> Bool {
            switch self {
            case .foods: food.foodKind != "override"
            case .edits: food.foodKind == "override"
            default: true
            }
        }
    }

    public enum Sort: String, CaseIterable, Sendable {
        case recent, used, az

        public var title: String {
            switch self {
            case .recent: "Recent"
            case .used: "Most used"
            case .az: "A–Z"
            }
        }
    }

    public static let noFoods = "Foods you create, correct or save as recipes on the web show up here"
    public static let noMatches = "No matches"

    public var query = ""
    public var filter: Filter = .all
    public var sort: Sort = .recent
    public private(set) var foods: [Food] = []
    public private(set) var loaded = false
    public private(set) var message: String?
    /// The meal new portions start in (the time of day's meal).
    public var meal: Meal

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let dayStore: DayStore
    @ObservationIgnored private var loadNumber = 0

    public init(api: APIClient, dayStore: DayStore, now: @escaping () -> Date = Date.init) {
        self.api = api
        self.dayStore = dayStore
        meal = Meal.suggested(at: now(), in: dayStore.zone)
    }

    /// What to say when the list is empty (nil when it isn't).
    public var emptyText: String? {
        guard loaded, foods.isEmpty else { return nil }
        return query.trimmingCharacters(in: .whitespaces).isEmpty && filter == .all ? Self.noFoods : Self.noMatches
    }

    public func load() async {
        loadNumber += 1
        let mine = loadNumber
        let filter = filter
        do {
            let list = try await api.send(MyFoodsAPI.list(q: query.trimmingCharacters(in: .whitespaces), kind: filter.serverKind, sort: sort.rawValue))
            guard mine == loadNumber else { return } // a newer search took over
            foods = list.foods.filter(filter.keeps)
            message = nil
        } catch {
            guard mine == loadNumber else { return }
            message = (error as? APIError)?.message ?? error.localizedDescription
        }
        loaded = true
    }

    /// Typing in search: wait a moment, then search unless more was typed.
    public func queryChanged() async {
        loadNumber += 1
        let mine = loadNumber
        try? await Task.sleep(for: .milliseconds(300))
        guard mine == loadNumber else { return }
        await load()
    }

    /// A quick meal's items, ready to log to the day being looked at.
    public func quickMeal(_ food: Food) -> QuickMealModel { QuickMealModel(api: api, dayStore: dayStore, food: food, meal: meal) }

    public func log(_ food: Food, portion: PortionModel) async -> Bool {
        do {
            _ = try await api.send(FoodAPI.log(food: food, day: dayStore.selected, meal: portion.meal, servingIndex: portion.servingIndex, unit: portion.unit, quantity: portion.quantity))
            message = nil
            await dayStore.reload()
            return true
        } catch {
            message = (error as? APIError)?.message ?? error.localizedDescription
            return false
        }
    }
}
