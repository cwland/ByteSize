import Foundation
import Observation

/// How much of a food to log: one of its servings, an amount and a fraction (¼ ⅓ ½ ¾ All), and the meal.
/// The calories shown are a preview (per serving × amount); the server's numbers rule once it's logged.
@MainActor
@Observable
public final class PortionModel {
    public let name: String
    public let icon: String
    public let servings: [Serving]
    /// Per `servings[0]`.
    public let nutrients: Nutrients
    public var servingIndex = 0
    public var quantityText = "1"
    public var fraction: Double = 1
    public var meal: Meal

    public static let fractions: [Double] = [0.25, 1.0 / 3, 0.5, 0.75, 1]

    public init(name: String, icon: String, servings: [Serving], nutrients: Nutrients, meal: Meal) {
        self.name = name
        self.icon = icon
        self.servings = servings
        self.nutrients = nutrients
        self.meal = meal
    }

    public convenience init(food: Food, meal: Meal) {
        self.init(name: food.name, icon: food.icon, servings: food.servings, nutrients: food.nutrients, meal: meal)
    }

    /// The typed amount when it's a number above 0 ("," accepted as the decimal point).
    public var quantity: Double? {
        let text = quantityText.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        guard let value = Double(text), value > 0, value.isFinite else { return nil }
        return value
    }

    public var canLog: Bool { quantity != nil && servings.indices.contains(servingIndex) }

    public var previewCalories: Int? {
        guard let quantity, canLog else { return nil }
        return Int((nutrients["calories"] * factor(servingIndex) * quantity * fraction).rounded())
    }

    /// How many of `servings[0]` one of `servings[i]` is: by grams or ml when both have them, else 1.
    private func factor(_ i: Int) -> Double {
        let first = servings[0], other = servings[i]
        if let a = first.grams, let b = other.grams, a > 0 { return b / a }
        if let a = first.ml, let b = other.ml, a > 0 { return b / a }
        return 1
    }
}
