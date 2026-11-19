import Foundation

/// The account's units: the server stores kg and ml; imperial shows lb and fl oz.
public enum Units: Sendable, Equatable {
    case imperial, metric

    static let lbPerKg = 2.20462262
    static let mlPerFlOz = 29.5735296

    public init(_ server: String?) { self = server == "metric" ? .metric : .imperial }

    public var weightUnit: String { self == .metric ? "kg" : "lb" }
    public var waterUnit: String { self == .metric ? "ml" : "fl oz" }

    /// "181.4 lb" / "82.3 kg"
    public func weight(kg: Double) -> String {
        let value = self == .metric ? kg : kg * Self.lbPerKg
        return "\(String(format: "%.1f", value)) \(weightUnit)"
    }

    /// The weight number alone in this unit (for inputs and charts).
    public func weightValue(kg: Double) -> Double { self == .metric ? kg : kg * Self.lbPerKg }

    /// "16 fl oz" / "500 ml" (whole numbers)
    public func water(ml: Double) -> String {
        let value = self == .metric ? ml : ml / Self.mlPerFlOz
        return "\(Int(value.rounded())) \(waterUnit)"
    }

    public func kg(fromDisplay value: Double) -> Double { self == .metric ? value : value / Self.lbPerKg }
}
