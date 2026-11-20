import Foundation

/// One way to measure a food (the first is what its nutrients are per).
public struct Serving: Codable, Hashable, Sendable {
    public let label: String
    public let grams: Double?
    public let ml: Double?
    /// How many of servings[0] one of this is, for a counted unit with no weight ("1 cracker" of "12 crackers").
    public let per: Double?
    /// Worked out by the server from the food's servings ("1 prune" from "5 prunes"); never saved on a food.
    public let derived: Bool?

    public init(label: String, grams: Double? = nil, ml: Double? = nil, per: Double? = nil, derived: Bool? = nil) {
        self.label = label
        self.grams = grams
        self.ml = ml
        self.per = per
        self.derived = derived
    }
}

/// A logged food or water (a snapshot: editing the food later never changes it).
public struct LogEntry: Codable, Identifiable, Equatable, Sendable {
    public let id: Int
    public let day: String
    public let meal: Meal
    public let name: String
    public let brand: String?
    public let icon: String
    public let servingIndex: Int
    public let unit: String
    public let quantity: Double
    public let fraction: Double
    public let servings: [Serving]
    public let nutrients: Nutrients
    public let aiEstimated: Bool
    public let source: String

    public var isWater: Bool { source == "water" }
    public var calories: Double { nutrients["calories"] }

    /// "2 × 1 cup", "½ × 1 bar", "1.5 × ½ × 1 cup", "120 g"; water: "17 fl oz" / "500 ml".
    public func amountText(units: Units) -> String {
        if isWater { return units.water(ml: quantity * fraction) }
        let base: String
        if unit == "serving" {
            let label = servings.indices.contains(servingIndex) ? servings[servingIndex].label : "serving"
            base = quantity == 1 && fraction != 1 ? label : "\(Self.count(quantity)) × \(label)"
        } else {
            let amount = unit == "g" || unit == "ml" ? Self.number(quantity) : Self.count(quantity)
            base = "\(amount) \(Self.unitNames[unit] ?? unit)"
        }
        return fraction == 1 ? base : "\(Self.fractionText(fraction)) × \(base)"
    }

    static let unitNames = ["g": "g", "oz": "oz", "ml": "ml", "fl_oz": "fl oz", "cup": "cup", "tbsp": "tbsp", "tsp": "tsp"]

    /// 2.5 → "2½", 0.375 → "⅜" (the wheel's fractions); anything else as a number.
    static func count(_ v: Double) -> String {
        let whole = (v + 0.001).rounded(.down)
        let rest = v - whole
        if abs(rest) < 0.001 { return String(Int(whole)) }
        if let f = AmountMath.fractions.dropFirst().first(where: { abs($0.value - rest) < 0.001 }) {
            return whole == 0 ? f.label : "\(Int(whole))\(f.label)"
        }
        return number(v)
    }

    static func number(_ v: Double) -> String {
        v.rounded() == v ? String(Int(v)) : String(format: "%g", (v * 100).rounded() / 100)
    }

    public static func fractionText(_ f: Double) -> String {
        let known: [(Double, String)] = [(0.25, "¼"), (1.0 / 3, "⅓"), (0.5, "½"), (2.0 / 3, "⅔"), (0.75, "¾")]
        if let hit = known.first(where: { abs($0.0 - f) < 0.001 }) { return hit.1 }
        return "\(Int((f * 100).rounded()))%"
    }
}
