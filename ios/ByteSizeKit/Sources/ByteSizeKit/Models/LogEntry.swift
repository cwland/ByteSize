import Foundation

/// One way to measure a food (the first is what its nutrients are per).
public struct Serving: Codable, Equatable, Sendable {
    public let label: String
    public let grams: Double?
    public let ml: Double?
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
            base = quantity == 1 && fraction != 1 ? label : "\(Self.number(quantity)) × \(label)"
        } else {
            base = "\(Self.number(quantity)) \(Self.unitNames[unit] ?? unit)"
        }
        return fraction == 1 ? base : "\(Self.fractionText(fraction)) × \(base)"
    }

    static let unitNames = ["g": "g", "oz": "oz", "ml": "ml", "fl_oz": "fl oz", "cup": "cup", "tbsp": "tbsp", "tsp": "tsp"]

    static func number(_ v: Double) -> String {
        v.rounded() == v ? String(Int(v)) : String(format: "%g", (v * 100).rounded() / 100)
    }

    public static func fractionText(_ f: Double) -> String {
        let known: [(Double, String)] = [(0.25, "¼"), (1.0 / 3, "⅓"), (0.5, "½"), (2.0 / 3, "⅔"), (0.75, "¾")]
        if let hit = known.first(where: { abs($0.0 - f) < 0.001 }) { return hit.1 }
        return "\(Int((f * 100).rounded()))%"
    }
}
