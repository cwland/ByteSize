import Foundation

/// One ingredient of a recipe or food of a quick meal, as the editors change it (the website's EditItem): its food,
/// that food's servings and per-serving numbers, and the amount.
public struct EditItem: Identifiable, Equatable, Sendable {
    public let id = UUID()
    public let food: FoodRef
    public let foodKind: String?
    public let name: String
    public let icon: String
    public let servings: [Serving]
    /// The food's, per its servings[0].
    public let perServing: Nutrients
    /// false: the food is archived or gone; its saved amount is kept.
    public let available: Bool
    public private(set) var servingIndex: Int
    public private(set) var unit: String
    public private(set) var quantity: Double
    public private(set) var fraction: Double

    /// As saved in a recipe or quick meal.
    public init(_ item: MealItem) {
        food = item.food
        foodKind = nil
        name = item.name
        icon = item.icon
        servings = item.servings
        perServing = item.perServing
        available = item.available
        servingIndex = item.servingIndex
        unit = item.unit
        quantity = item.quantity
        fraction = item.fraction
    }

    /// A food picked from the search, at the amount chosen on the wheel.
    @MainActor
    public init(food: Food, portion: PortionModel) {
        self.food = FoodRef(kind: food.kind, id: food.id)
        foodKind = food.foodKind
        name = food.name
        icon = food.icon
        servings = food.servings
        perServing = food.nutrients
        available = true
        servingIndex = portion.servingIndex
        unit = portion.unit.rawValue
        quantity = portion.quantity
        fraction = 1
    }

    /// The wheel's choice (its fraction is part of the quantity).
    public mutating func setPortion(servingIndex: Int, unit: String, quantity: Double) {
        guard quantity > 0, quantity.isFinite else { return }
        self.servingIndex = servingIndex
        self.unit = unit
        self.quantity = quantity
        fraction = 1
    }

    public var body: MealItemBody { MealItemBody(food: food, servingIndex: servingIndex, unit: unit, quantity: quantity, fraction: fraction) }

    /// This amount's nutrients, unrounded (empty when it can't be measured).
    public var nutrients: Nutrients {
        guard let f = AmountMath.factor(servings, servingIndex: servingIndex, unit: AmountUnit(rawValue: unit) ?? .serving, quantity: quantity) else { return Nutrients() }
        return Nutrients(perServing.values.mapValues { $0 * f * fraction })
    }

    /// The exact sum (a nutrient an item doesn't say adds as 0), every nutrient listed.
    public static func sum(_ items: [EditItem]) -> Nutrients {
        let each = items.map(\.nutrients)
        return Nutrients(Dictionary(uniqueKeysWithValues: Nutrients.keys.map { k in (k.key, each.reduce(0) { $0 + ($1.values[k.key] ?? 0) }) }))
    }

    public static func == (a: EditItem, b: EditItem) -> Bool { a.id == b.id && a.body == b.body }
}

extension Nutrients {
    /// Per one of `count` servings; nothing when the count isn't above 0.
    public func divided(by count: Double) -> Nutrients {
        count > 0 ? Nutrients(values.mapValues { $0 / count }) : Nutrients()
    }
}


extension EditItem {
    /// The amount wheel for this item, at its amount.
    @MainActor
    public func portion() -> PortionModel {
        let p = PortionModel(name: name, icon: icon, servings: servings, nutrients: perServing, meal: .snacks)
        let u = AmountUnit(rawValue: unit) ?? .serving
        p.choice = u == .serving ? .serving(servingIndex) : .unit(u)
        (p.whole, p.fraction) = PortionModel.split(quantity * fraction)
        return p
    }
}
