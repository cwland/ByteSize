import Foundation
import Observation

/// Describe Food and Photo: the AI's list of foods (with amounts) to adjust, then log them all at once.
/// Logged as AI-estimated entries; nothing is saved to My Foods.
@MainActor
@Observable
public final class EstimateModel {
    public enum PhotoOutcome: Equatable {
        /// A barcode in the photo, and a food for it.
        case food(Food)
        /// A nutrition label, read.
        case draft(AiDraft)
        /// A plate of food: see `items`.
        case items
        /// Nothing usable: see `message`.
        case nothing
    }

    public var text = ""
    public private(set) var items: [EstimateItem] = []
    public private(set) var busy = false
    public private(set) var message: String?
    public private(set) var assumedNote: String?
    public var meal: Meal

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let dayStore: DayStore

    public static let needsAI = "Describe Food needs an AI service — set one up in the web app"
    public static let needsPhotoAI = "Photos need a photo AI service — set one up in the web app"
    public static let noFood = "Couldn't make out the food in that photo"

    public init(api: APIClient, dayStore: DayStore, now: () -> Date = Date.init) {
        self.api = api
        self.dayStore = dayStore
        self.meal = Meal.suggested(at: now(), in: dayStore.zone)
    }

    /// ≈ calories of everything listed (the server's numbers rule once logged).
    public var totalCalories: Int { Int(items.reduce(0) { $0 + $1.calories }.rounded()) }

    /// Bumped by each description and by the ⓧ: an answer for an older one is dropped (review fix).
    private var describing = 0

    public func describe() async {
        describing += 1
        let mine = describing
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard words.count >= 2 else {
            message = "Describe what you ate"
            return
        }
        busy = true
        defer { busy = false }
        message = nil
        assumedNote = nil
        items = [] // a new description: never the old list under a new answer (or error)
        do {
            let result = try await api.send(FoodAPI.estimateItems(words))
            guard mine == describing else { return } // cleared (or described again) while this was on its way
            items = result.items
            if result.assumed, let taken = result.interpretedAs { assumedNote = "Took it as “\(taken)”" }
        } catch APIError.server(503, _) {
            guard mine == describing else { return }
            message = Self.needsAI
        } catch {
            guard mine == describing else { return }
            message = Self.text(error)
        }
    }

    /// SPEC-21: the ⓧ in the field — the description and the last estimate both go, ready for the next.
    public func clearDescription() {
        describing += 1
        text = ""
        items = []
        message = nil
        assumedNote = nil
    }

    /// A photo: a barcode or a label first; otherwise the foods on the plate.
    public func photo(jpeg: Data) async -> PhotoOutcome {
        busy = true
        defer { busy = false }
        message = nil
        assumedNote = nil
        do {
            let first = try await api.send(FoodAPI.analyzePhoto(jpeg: jpeg, mode: .auto))
            if let food = first.food { return .food(food) }
            if let draft = first.draft { return .draft(draft) }
            guard first.labelReading else {
                message = Self.needsPhotoAI
                return .nothing
            }
            let plate = try await api.send(FoodAPI.analyzePhoto(jpeg: jpeg, mode: .plate))
            let found = plate.plate?.items ?? []
            guard !found.isEmpty else {
                message = plate.errors.first?.message ?? Self.noFood
                return .nothing
            }
            items = found
            return .items
        } catch APIError.server(503, _) {
            message = Self.needsPhotoAI
            return .nothing
        } catch {
            message = Self.text(error)
            return .nothing
        }
    }

    /// A label read from a photo, saved as the person's own food (no barcode), ready to log.
    public func save(_ draft: AiDraft, original: AiDraft? = nil) async -> Food? {
        busy = true
        defer { busy = false }
        do {
            return try await api.send(FoodAPI.saveFood(draft, barcode: nil, original: original)).food
        } catch {
            message = Self.text(error)
            return nil
        }
    }

    public func setQuantity(_ q: Double, at i: Int) {
        guard items.indices.contains(i), q > 0, q.isFinite else { return }
        items[i].quantity = q
    }

    /// The wheel's choice for one item: which of its servings and how many.
    public func setPortion(servingIndex: Int, quantity: Double, at i: Int) {
        guard items.indices.contains(i), items[i].food.servings.indices.contains(servingIndex), quantity > 0, quantity.isFinite else { return }
        items[i].servingIndex = servingIndex
        items[i].quantity = quantity
    }

    public func remove(at i: Int) {
        guard items.indices.contains(i) else { return }
        items.remove(at: i)
    }

    /// Logs every item on the day being looked at, in `meal`; the day reloads.
    public func logAll() async -> Bool {
        guard !items.isEmpty else { return false }
        busy = true
        defer { busy = false }
        do {
            _ = try await api.send(FoodAPI.logEstimates(items, day: dayStore.selected, meal: meal))
            items = []
            text = ""
            assumedNote = nil
            message = nil
            await dayStore.reload()
            return true
        } catch {
            message = Self.text(error)
            return false
        }
    }

    private static func text(_ error: Error) -> String {
        (error as? APIError)?.message ?? error.localizedDescription
    }
}
