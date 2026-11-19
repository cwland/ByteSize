import Foundation

/// Nutrient amounts keyed by the server's names (`calories`, `protein_g`, `water_ml`…). A missing or null
/// nutrient reads as 0 (Cory's rule: unknown counts as zero).
public struct Nutrients: Codable, Equatable, Sendable {
    public let values: [String: Double]

    public init(_ values: [String: Double] = [:]) { self.values = values }

    public subscript(_ key: String) -> Double { values[key] ?? 0 }

    private struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        var out: [String: Double] = [:]
        for key in c.allKeys {
            if let v = try? c.decodeIfPresent(Double.self, forKey: key) { out[key.stringValue] = v }
        }
        values = out
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        for (k, v) in values { try c.encode(v, forKey: Key(stringValue: k)) }
    }
}
