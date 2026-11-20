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

    public func describe() async {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard words.count >= 2 else {
            message = "Describe what you ate"
            return
        }
        busy = true
        defer { busy = false }
        message = nil
        assumedNote = nil
        do {
            let result = try await api.send(FoodAPI.estimateItems(words))
            items = result.items
            if result.assumed, let taken = result.interpretedAs { assumedNote = "Took it as “\(taken)”" }
        } catch APIError.server(503, _) {
            message = Self.needsAI
        } catch {
            message = Self.text(error)
        }
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
    public func save(_ draft: AiDraft) async -> Food? {
        busy = true
        defer { busy = false }
        do {
            return try await api.send(FoodAPI.saveFood(draft, barcode: nil)).food
        } catch {
            message = Self.text(error)
            return nil
        }
    }

    public func setQuantity(_ q: Double, at i: Int) {
        guard items.indices.contains(i), q > 0, q.isFinite else { return }
        items[i].quantity = q
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
