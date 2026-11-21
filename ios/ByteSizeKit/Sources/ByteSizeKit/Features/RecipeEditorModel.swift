import Foundation
import Observation

/// New or existing recipe (the website's RecipeEditor): a name, ingredients with amounts, how many servings it makes,
/// the weight of one serving (optional), notes and live per-serving totals. Save stores the numbers; Recalculate
/// re-reads the ingredients' foods, once any changes are saved.
@MainActor
@Observable
public final class RecipeEditorModel {
    public let id: Int?
    public var name = ""
    public var servings = "1"
    public var weight = ""
    public var notes = ""
    public private(set) var items: [EditItem] = []
    public private(set) var loaded: Bool
    public private(set) var busy = false
    public private(set) var message: String?
    public private(set) var notice: String?
    /// The form as loaded (or last recalculated): Recalculate works on the saved recipe.
    @ObservationIgnored private var loadedAs: String?

    @ObservationIgnored private let api: APIClient

    public init(api: APIClient, id: Int?) {
        self.api = api
        self.id = id
        loaded = id == nil
    }

    public func load() async {
        guard let id else { return }
        do {
            let detail = try await api.send(MyFoodsAPI.detail(id: id)).food
            name = detail.name ?? ""
            servings = FoodEditorModel.text(detail.recipeServings ?? 1)
            weight = detail.servingGrams.map(FoodEditorModel.text) ?? ""
            notes = detail.notes ?? ""
            items = (detail.items ?? []).map(EditItem.init)
            loadedAs = key
            message = nil
        } catch {
            message = FoodEditorModel.errorText(error)
        }
        loaded = true
    }

    /// Ingredients can't be quick meals, or this recipe.
    public func allows(_ food: Food) -> Bool {
        food.foodKind != "quick_meal" && !(food.kind == "user_food" && food.id == id)
    }

    public func add(_ item: EditItem) { items.append(item) }

    public func remove(at i: Int) {
        guard items.indices.contains(i) else { return }
        items.remove(at: i)
    }

    public func setPortion(at i: Int, servingIndex: Int, unit: String, quantity: Double) {
        guard items.indices.contains(i) else { return }
        items[i].setPortion(servingIndex: servingIndex, unit: unit, quantity: quantity)
    }

    private var count: Double? { Double(servings.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")) }

    public var perServing: Nutrients { EditItem.sum(items).divided(by: count ?? 0) }

    private var key: String { [name, servings, weight, notes, items.map { "\($0.body)" }.joined(separator: "|")].joined(separator: "§") }

    public var changed: Bool { loadedAs != key }

    public var canRecalculate: Bool { id != nil && !changed && !busy }

    public func recalculate() async {
        guard let id, canRecalculate else { return }
        busy = true
        defer { busy = false }
        do {
            let fresh = try await api.send(MyFoodsAPI.recalculate(id: id)).food
            items = (fresh.items ?? []).map(EditItem.init)
            loadedAs = key
            message = nil
            notice = "Recalculated"
        } catch {
            message = FoodEditorModel.errorText(error)
        }
    }

    public func save() async -> Food? {
        notice = nil
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        let w = weight.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        let grams: Double? = w.isEmpty ? nil : (Double(w) ?? -1)
        guard !trimmed.isEmpty else { message = "Give the recipe a name"; return nil }
        guard !items.isEmpty else { message = "Add at least one ingredient"; return nil }
        guard let n = count, n > 0 else { message = "The number of servings must be more than 0"; return nil }
        if let grams, !(grams > 0) { message = "The weight of one serving must be more than 0 g"; return nil }
        let text = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = items.map(\.body)
        busy = true
        defer { busy = false }
        do {
            let out = try await api.send(id.map { MyFoodsAPI.updateRecipe(id: $0, name: trimmed, items: body, servings: n, servingGrams: grams, notes: text.isEmpty ? nil : text) }
                ?? MyFoodsAPI.createRecipe(name: trimmed, items: body, servings: n, servingGrams: grams, notes: text.isEmpty ? nil : text))
            message = nil
            return out.food
        } catch {
            message = FoodEditorModel.errorText(error)
            return nil
        }
    }
}
