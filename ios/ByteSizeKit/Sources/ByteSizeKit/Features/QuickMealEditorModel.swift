import Foundation
import Observation

/// New or existing quick meal (the website's QuickMealEditor): a name and foods with amounts, with the live total.
@MainActor
@Observable
public final class QuickMealEditorModel {
    public let id: Int?
    public var name = ""
    public private(set) var items: [EditItem] = []
    public private(set) var loaded: Bool
    public private(set) var busy = false
    public private(set) var message: String?

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
            items = (detail.items ?? []).map(EditItem.init)
            message = nil
        } catch {
            message = FoodEditorModel.errorText(error)
        }
        loaded = true
    }

    /// A quick meal can't hold another quick meal.
    public func allows(_ food: Food) -> Bool { food.foodKind != "quick_meal" }

    public func add(_ item: EditItem) { items.append(item) }

    public func remove(at i: Int) {
        guard items.indices.contains(i) else { return }
        items.remove(at: i)
    }

    public func setPortion(at i: Int, servingIndex: Int, unit: String, quantity: Double) {
        guard items.indices.contains(i) else { return }
        items[i].setPortion(servingIndex: servingIndex, unit: unit, quantity: quantity)
    }

    public var total: Nutrients { EditItem.sum(items) }

    public func save() async -> Food? {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { message = "Give the meal a name"; return nil }
        guard !items.isEmpty else { message = "Add at least one food"; return nil }
        let body = items.map(\.body)
        busy = true
        defer { busy = false }
        do {
            let out = try await api.send(id.map { MyFoodsAPI.updateMeal(id: $0, name: trimmed, items: body) } ?? MyFoodsAPI.createMeal(name: trimmed, items: body))
            message = nil
            return out.food
        } catch {
            message = FoodEditorModel.errorText(error)
            return nil
        }
    }
}
