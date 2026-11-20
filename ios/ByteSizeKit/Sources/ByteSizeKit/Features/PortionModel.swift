import Foundation
import Observation

/// What an amount is counted in: one of the food's servings (by index), or a weight or volume unit.
public enum UnitChoice: Hashable, Sendable {
    case serving(Int)
    case unit(AmountUnit)
}

/// How much of a food to log (L1): whole + fraction of any unit the food offers, and the meal. The calories shown
/// are a preview from the same math as the server (AmountMath); the server's numbers rule once it's logged.
@MainActor
@Observable
public final class PortionModel {
    public let name: String
    public let icon: String
    public let servings: [Serving]
    /// Per `servings[0]`.
    public let nutrients: Nutrients
    public var whole = 1
    public var fraction: Double = 0
    public var choice: UnitChoice = .serving(0)
    public var meal: Meal
    /// AI estimates are logged in their own servings only (POST /api/log/estimates takes no unit).
    public let servingsOnly: Bool

    public init(name: String, icon: String, servings: [Serving], nutrients: Nutrients, meal: Meal, servingsOnly: Bool = false) {
        self.name = name
        self.icon = icon
        self.servings = servings
        self.nutrients = nutrients
        self.meal = meal
        self.servingsOnly = servingsOnly
    }

    public convenience init(food: Food, meal: Meal) {
        self.init(name: food.name, icon: food.icon, servings: food.servings, nutrients: food.nutrients, meal: meal)
        // Recent, favorites, same as yesterday: start at the amount it was last logged at
        if let last = food.last, let unit = AmountUnit(rawValue: last.unit) {
            if unit == .serving {
                guard food.servings.indices.contains(last.servingIndex) else { return }
                choice = .serving(last.servingIndex)
            } else {
                choice = .unit(unit)
            }
            (whole, fraction) = Self.split(last.quantity * last.fraction)
        }
    }

    /// A logged entry, to change its amount: the same unit and amount it was logged with.
    public convenience init(entry: LogEntry) {
        let unit = AmountUnit(rawValue: entry.unit) ?? .serving
        let amount = entry.quantity * entry.fraction
        // The food's own per-serving nutrients when the server sends them; otherwise the entry's
        // (rounded) nutrients for its amount, worked back to one of servings[0]
        let per: Nutrients
        if let own = entry.perServing {
            per = own
        } else {
            let factor = AmountMath.factor(entry.servings, servingIndex: entry.servingIndex, unit: unit, quantity: amount) ?? 0
            per = factor > 0 ? Nutrients(entry.nutrients.values.mapValues { $0 / factor }) : Nutrients()
        }
        self.init(name: entry.name, icon: entry.icon, servings: entry.servings, nutrients: per, meal: entry.meal)
        choice = unit == .serving ? .serving(entry.servingIndex) : .unit(unit)
        (whole, fraction) = Self.split(amount)
    }

    /// 2.4 → (2, ⅜): the whole number and the nearest fraction on the wheel (a remainder nearer 1 rounds up).
    public static func split(_ amount: Double) -> (Int, Double) {
        var whole = Int(amount.rounded(.down))
        let rest = amount - Double(whole)
        var best = 0.0
        var bestDiff = rest
        for f in AmountMath.fractions.dropFirst() where abs(rest - f.value) < bestDiff {
            best = f.value
            bestDiff = abs(rest - f.value)
        }
        if 1 - rest < bestDiff {
            whole += 1
            best = 0
        }
        return (whole, best)
    }

    /// Every unit this food can be measured in, labelled.
    public var choices: [(choice: UnitChoice, label: String)] {
        var out = servings.enumerated().map { (UnitChoice.serving($0.offset), $0.element.label) }
        guard let base = servings.first, !servingsOnly else { return out }
        if (base.grams ?? 0) > 0 { out += [AmountUnit.g, .oz].map { (UnitChoice.unit($0), $0.label) } }
        if (base.ml ?? 0) > 0 { out += [AmountUnit.ml, .fl_oz, .cup, .tbsp, .tsp].map { (UnitChoice.unit($0), $0.label) } }
        return out
    }

    public var servingIndex: Int {
        if case .serving(let i) = choice { return i }
        return 0
    }

    public var unit: AmountUnit {
        if case .unit(let u) = choice { return u }
        return .serving
    }

    public var quantity: Double { Double(whole) + fraction }

    /// How many of servings[0]; nil when this unit can't measure the food.
    public var factor: Double? { AmountMath.factor(servings, servingIndex: servingIndex, unit: unit, quantity: quantity) }

    public var canLog: Bool { quantity > 0 && factor != nil }

    public var previewCalories: Int? {
        guard canLog, let factor else { return nil }
        return Int((nutrients["calories"] * factor).rounded())
    }

    /// More than 20 servings or 2,000 calories: asks first.
    public var isBig: Bool { AmountMath.isBig(factor: factor ?? 0, calories: Double(previewCalories ?? 0)) }

    /// The whole-number wheel: 0–20, and for grams and millilitres bigger steps up to 1,000 (as the web).
    public var wholeRange: [Int] {
        var out = Array(0...20)
        if unit == .g || unit == .ml {
            out += Array(stride(from: 25, through: 100, by: 5)) + Array(stride(from: 125, through: 500, by: 25)) + Array(stride(from: 550, through: 1000, by: 50))
        }
        if !out.contains(whole) { out.append(whole) }
        return out.sorted()
    }
}
