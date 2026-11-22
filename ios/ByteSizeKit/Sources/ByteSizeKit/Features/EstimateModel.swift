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

    /// Describe with several foods: logged as one meal (one entry) or as separate items (one per checked food).
    public enum LogMode: Equatable, Sendable { case meal, items }

    public var text = ""
    public private(set) var items: [EstimateItem] = []
    /// One meal or Separate items; One meal only when the foods came with a name (`showsSwitch`).
    public var mode: LogMode = .items
    /// The name One meal logs under (the AI's, renameable).
    public var mealName = ""
    /// Save One meal to My foods as one custom food (off unless ticked).
    public var saveToMyFoods = false
    /// Several foods from a description: the One meal / Separate items switch shows.
    public private(set) var showsSwitch = false
    /// "Add a food": words asked of the AI, whose foods join the list.
    public var addText = ""
    public private(set) var adding = false
    /// One check per item: checked foods are logged and counted (all checked whenever a list arrives).
    public private(set) var selected: [Bool] = []
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

    /// ≈ calories of the checked foods (the server's numbers rule once logged).
    public var totalCalories: Int { Int(chosen.reduce(0) { $0 + $1.calories }.rounded()) }

    public var selectedCount: Int { selected.filter { $0 }.count }
    /// One meal logs every food listed; Separate items the checked ones. One meal needs a name.
    public var canLog: Bool {
        guard !busy, !adding, !chosen.isEmpty else { return false }
        return !isMeal || !mealName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var isMeal: Bool { showsSwitch && mode == .meal }

    /// A new list (or none): every food checked; a name for several foods opens on One meal (design decision 1).
    private func show(_ list: [EstimateItem], mealName name: String? = nil) {
        items = list
        selected = Array(repeating: true, count: list.count)
        showsSwitch = name != nil && list.count > 1
        mealName = name ?? ""
        mode = showsSwitch ? .meal : .items
        saveToMyFoods = false
        addText = ""
    }

    private var chosen: [EstimateItem] { isMeal ? items : items.indices.filter { selected[$0] }.map { items[$0] } }

    /// Takes one food off the list (both views).
    public func remove(at i: Int) {
        guard items.indices.contains(i) else { return }
        items.remove(at: i)
        selected.remove(at: i)
    }

    /// "Add a food": asks the AI for `addText` and adds what it finds (checked) to the list.
    public func addFood() async {
        let words = addText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard words.count >= 2, !adding else { return }
        adding = true
        defer { adding = false }
        message = nil
        do {
            let result = try await api.send(FoodAPI.estimateItems(words))
            items += result.items
            selected += Array(repeating: true, count: result.items.count)
            addText = ""
        } catch APIError.server(503, _) {
            message = Self.needsAI
        } catch {
            message = Self.text(error)
        }
    }

    /// Check or uncheck one food: an unchecked one stays listed but isn't logged.
    public func toggle(at i: Int) {
        guard selected.indices.contains(i) else { return }
        selected[i].toggle()
    }

    /// Retake photo: the list goes, ready for the next photo.
    public func clearItems() {
        show([])
        message = nil
        assumedNote = nil
    }

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
        show([]) // a new description: never the old list under a new answer (or error); its checks go too
        do {
            let result = try await api.send(FoodAPI.estimateItems(words))
            guard mine == describing else { return } // cleared (or described again) while this was on its way
            show(result.items, mealName: result.mealName)
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
        show([])
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
            show(found)
            let toCheck = found.filter { $0.checkAmount == true }.map(\.food.name)
            if !toCheck.isEmpty { assumedNote = "Check the amount: " + toCheck.joined(separator: ", ") }
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

    /// Logs the checked items on the day being looked at, in `meal`; the day reloads.
    public func logSelected() async -> Bool {
        guard canLog else { return false }
        busy = true
        defer { busy = false }
        do {
            let combine = isMeal ? (name: mealName.trimmingCharacters(in: .whitespacesAndNewlines), save: saveToMyFoods) : nil
            _ = try await api.send(FoodAPI.logEstimates(chosen, day: dayStore.selected, meal: meal, combine: combine))
            show([])
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
