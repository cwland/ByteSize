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
        // Recent, favorites, same as yesterday: the amount it was last logged at; else its package serving
        if food.last != nil || food.start != nil, case let last = food.startingAmount, let unit = AmountUnit(rawValue: last.unit) {
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

    /// A quick meal's or recipe's item at its saved amount.
    public convenience init(item: MealItem, meal: Meal) {
        let unit = AmountUnit(rawValue: item.unit) ?? .serving
        self.init(name: item.name, icon: item.icon, servings: item.servings, nutrients: item.perServing, meal: meal)
        choice = unit == .serving ? .serving(item.servingIndex) : .unit(unit)
        (whole, fraction) = Self.split(item.quantity * item.fraction)
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

    /// The unit as the wheel shows it: "tbsp" for a "1 tbsp" serving (2 | tbsp), "SLICE (30 g)" for "1 SLICE (30 g)".
    public func label(for choice: UnitChoice) -> String {
        let label = choices.first { $0.choice == choice }?.label ?? ""
        guard case .serving = choice, label.hasPrefix("1 "), label.count > 2 else { return label }
        let one = String(label.dropFirst(2))
        // keeps its 1 when it would read the same as a unit on the wheel ("1 cup" of a drink that also has cups)
        let units = choices.compactMap { if case .unit = $0.choice { return $0.label.lowercased() } else { return nil } }
        return units.contains(one.lowercased()) ? label : one
    }

    /// The amount as the Serving row reads it: "2½ tbsp", "144 g", "2 Tbsp" (one of a counted serving), "2 × 2 Tbsp".
    public var amountText: String {
        let frac = AmountMath.fractions.first { abs($0.value - fraction) < 0.001 && $0.value > 0 }?.label ?? ""
        let number = whole == 0 && !frac.isEmpty ? frac : "\(whole)\(frac)"
        // a unit, or one the server worked out ("1 tbsp", "1 prune"): 2½ tbsp, 144 g, 6 prune
        if case .serving(let i) = choice, servings.indices.contains(i), servings[i].derived != true {
            // the package's own serving keeps its name: "1 SLICE (30 g)", "2 × 1 cup", as in the food log
            let own = servings[i].label
            return whole == 1 && frac.isEmpty ? own : "\(number) × \(own)"
        }
        return "\(number) \(label(for: choice))"
    }

    /// A list row's line for a food: the calories for the amount it opens at, then that amount —
    /// "80 cal · 1 SLICE (30 g)", "70 cal · 2½ tbsp" (never per 100 g when the package has a serving).
    public static func rowDetail(_ food: Food) -> String {
        let p = PortionModel(food: food, meal: .snacks)
        guard let kcal = p.previewCalories else { return p.amountText }
        return "\(kcal) cal · \(p.amountText)"
    }

    /// One nutrient for the amount chosen: "Protein", 3.3, "g".
    public struct Fact: Equatable, Sendable {
        public let key: String
        public let label: String
        public let value: Double
        public let unit: String
    }

    /// Every nutrient the food has, for the amount chosen, in the usual order.
    public var facts: [Fact] {
        let f = factor ?? 0
        return Nutrients.keys.compactMap { k in
            guard let v = nutrients.values[k.key] else { return nil }
            // "Protein (g)" → "Protein", "g"; "Calories" has no unit
            var label = k.label
            var unit = ""
            if let open = label.firstIndex(of: "("), label.hasSuffix(")") {
                unit = String(label[label.index(after: open)..<label.index(before: label.endIndex)])
                label = String(label[..<open]).trimmingCharacters(in: .whitespaces)
            }
            return Fact(key: k.key, label: label, value: v * f, unit: unit)
        }
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

    /// The whole-number wheel: 0–20, and for grams and millilitres every number to 1,000 (144 g is there; as the web).
    public var wholeRange: [Int] {
        var out = unit == .g || unit == .ml ? Array(0...1000) : Array(0...20)
        if !out.contains(whole) { out.append(whole) }
        return out.sorted()
    }
}
