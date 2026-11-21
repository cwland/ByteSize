import Foundation
import Observation

/// One of the person's own foods (a custom food or a "My edit" correction) as the food editor shows it: the website's
/// FoodForm on the phone. Name, brand, barcode, servings and the 13 nutrients (blank = unknown); AI guesses are marked
/// until edited. Save creates (POST) or edits (PATCH) it.
@MainActor
@Observable
public final class FoodEditorModel {
    public struct ServingRow: Identifiable, Equatable {
        public let id = UUID()
        public var label: String
        public var grams: String
        public var ml: String

        public init(label: String = "", grams: String = "", ml: String = "") {
            self.label = label
            self.grams = grams
            self.ml = ml
        }
    }

    public var name: String
    public var brand: String
    public var barcode: String
    public var servings: [ServingRow]
    public private(set) var values: [String: String]
    public private(set) var aiFields: Set<String>
    public private(set) var message: String?
    public private(set) var busy = false
    /// The food being edited (nil: a new one).
    public let food: Food?

    @ObservationIgnored private let api: APIClient

    public init(api: APIClient, food: Food?) {
        self.api = api
        self.food = food
        name = food?.name ?? ""
        brand = food?.brand ?? ""
        barcode = food?.barcode ?? ""
        let rows = (food?.servings ?? []).filter { $0.derived != true }.map { s in
            // An estimated volume isn't shown as a measured one, so saving never turns the guess into a real ml
            ServingRow(label: s.label, grams: s.grams.map(Self.text) ?? "", ml: s.approx == true ? "" : s.ml.map(Self.text) ?? "")
        }
        servings = rows.isEmpty ? [ServingRow(label: "1 serving")] : rows
        values = Dictionary(uniqueKeysWithValues: Nutrients.keys.map { k in (k.key, food?.nutrients.values[k.key].map(Self.text) ?? "") })
        aiFields = Set(food?.aiFields ?? [])
    }

    public var isNew: Bool { food == nil }

    /// A typed value: checked by a person, so no longer marked as the AI's guess.
    public func setValue(_ key: String, _ text: String) {
        values[key] = text
        aiFields.remove(key)
    }

    public func addServing() { servings.append(ServingRow()) }

    /// The first serving (what the nutrients are per) stays.
    public func removeServing(at i: Int) {
        guard i > 0, servings.indices.contains(i) else { return }
        servings.remove(at: i)
    }

    /// "Fill gaps with AI": only for a saved food with something blank.
    public var canFillGaps: Bool { food != nil && values.values.contains { $0.trimmingCharacters(in: .whitespaces).isEmpty } }

    public func fillGaps() async {
        guard let food, canFillGaps else { return }
        busy = true
        defer { busy = false }
        do {
            let out = try await api.send(MyFoodsAPI.fillGaps(id: food.id))
            for (key, v) in out.nutrients.values where (values[key] ?? "").trimmingCharacters(in: .whitespaces).isEmpty {
                values[key] = Self.text(v)
                if out.aiFields.contains(key) { aiFields.insert(key) }
            }
            message = nil
        } catch {
            message = Self.errorText(error)
        }
    }

    public func save() async -> Food? {
        let rows = servings.enumerated().filter { $0.offset == 0 || !$0.element.label.trimmingCharacters(in: .whitespaces).isEmpty }.map(\.element)
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            message = "Give the food a name"
            return nil
        }
        guard !rows[0].label.trimmingCharacters(in: .whitespaces).isEmpty else {
            message = "Name the serving size, like “1 cup”"
            return nil
        }
        var numbers: [String: Double] = [:]
        for (key, text) in values {
            let t = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
            if !t.isEmpty, let v = Double(t) { numbers[key] = v }
        }
        let body = MyFoodsAPI.FoodBody(
            name: trimmed,
            brand: Self.orNil(brand),
            barcode: Self.orNil(barcode),
            servings: rows.map { Serving(label: $0.label.trimmingCharacters(in: .whitespaces), grams: Self.number($0.grams), ml: Self.number($0.ml)) },
            nutrients: Nutrients(numbers),
            aiFields: aiFields.filter { numbers[$0] != nil }.sorted()
        )
        busy = true
        defer { busy = false }
        do {
            let out = try await api.send(food.map { MyFoodsAPI.updateFood(id: $0.id, body) } ?? MyFoodsAPI.createFood(body))
            message = nil
            return out.food
        } catch {
            message = Self.errorText(error)
            return nil
        }
    }

    static func text(_ v: Double) -> String {
        v.rounded() == v ? String(Int(v)) : String(v)
    }

    private static func number(_ s: String) -> Double? {
        let t = s.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        return t.isEmpty ? nil : Double(t)
    }

    private static func orNil(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? nil : t
    }

    static func errorText(_ error: Error) -> String {
        (error as? APIError)?.message ?? error.localizedDescription
    }
}
