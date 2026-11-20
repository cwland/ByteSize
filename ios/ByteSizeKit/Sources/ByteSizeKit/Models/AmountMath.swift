import Foundation

/// What an amount is measured in: one of the food's servings, or a weight or volume.
public enum AmountUnit: String, Codable, CaseIterable, Sendable {
    case serving, g, oz, ml, fl_oz, cup, tbsp, tsp

    public var label: String {
        switch self {
        case .serving: "serving"
        case .fl_oz: "fl oz"
        default: rawValue
        }
    }

    public var isMass: Bool { self == .g || self == .oz }
    public var isVolume: Bool { [.ml, .fl_oz, .cup, .tbsp, .tsp].contains(self) }
}

/// The server's portion math (backend lib/nutrients.ts amountFactor), for the "≈ N cal" preview. The shared
/// amount-vectors.json cases keep the two in step.
public enum AmountMath {
    static let gramsPer: [AmountUnit: Double] = [.g: 1, .oz: 28.349523125]
    static let mlPer: [AmountUnit: Double] = [.ml: 1, .fl_oz: 29.5735295625, .cup: 236.5882365, .tbsp: 14.78676478125, .tsp: 4.92892159375]

    /// How many of servings[0] this amount is; nil when the food can't be measured that way.
    public static func factor(_ servings: [Serving], servingIndex: Int, unit: AmountUnit, quantity: Double) -> Double? {
        guard let base = servings.first else { return nil }
        func positive(_ v: Double?) -> Double? { v.flatMap { $0 > 0 && $0.isFinite ? $0 : nil } }
        switch unit {
        case .serving:
            guard servings.indices.contains(servingIndex) else { return nil }
            if servingIndex == 0 { return quantity }
            let s = servings[servingIndex]
            if let g = positive(s.grams), let b = positive(base.grams) { return quantity * g / b }
            if let m = positive(s.ml), let b = positive(base.ml) { return quantity * m / b }
            if let p = positive(s.per) { return quantity * p }
            return nil
        default:
            if let g = gramsPer[unit] {
                guard let b = positive(base.grams) else { return nil }
                return quantity * g / b
            }
            guard let m = mlPer[unit], let b = positive(base.ml) else { return nil }
            return quantity * m / b
        }
    }

    /// The fraction wheel, in eighths with thirds (as the web).
    public static let fractions: [(value: Double, label: String)] = [
        (0, "—"), (0.125, "⅛"), (0.25, "¼"), (1.0 / 3, "⅓"), (0.375, "⅜"), (0.5, "½"), (0.625, "⅝"), (2.0 / 3, "⅔"), (0.75, "¾"), (0.875, "⅞"),
    ]

    public static let bigFactor = 20.0
    public static let bigCalories = 2000.0

    /// More than 20 of the food's serving, or more than 2,000 calories, asks first ("That's a lot").
    public static func isBig(factor: Double, calories: Double) -> Bool {
        factor > bigFactor || calories > bigCalories
    }
}
