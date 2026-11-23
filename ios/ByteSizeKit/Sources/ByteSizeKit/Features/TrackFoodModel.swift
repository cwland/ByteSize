import Foundation
import Observation

/// One of yesterday's entries in this meal (Same as yesterday), with the food behind it when there is one to open.
public struct YesterdayItem: Identifiable, Equatable, Sendable {
    public let entry: LogEntry
    public let food: Food?
    public var id: Int { entry.id }

    public init(entry: LogEntry, food: Food?) {
        self.entry = entry
        self.food = food
    }
}

/// Track Food: search (or a typed barcode); with the field empty, Same as yesterday, Favorites and Recently tracked
/// for the meal (L2), each one tap from logged; then log a portion.
@MainActor
@Observable
public final class TrackFoodModel {
    public var query = ""
    /// What was logged in this meal the day before the day being looked at, exactly as logged.
    public private(set) var yesterday: [YesterdayItem] = []
    public private(set) var favorites: [Food] = []
    public private(set) var recent: [Food] = []
    public private(set) var groups: [FoodGroup] = []
    /// The last answer whole (with the sources it asked), for the source chips to filter; nil when nothing's found.
    public private(set) var found: SearchResult?
    /// The answer for what's in the field now: gone the moment the search is cleared or shortened, not after the
    /// pause before the next search (TF2), so the chips and "N of M" never belong to an old search.
    public var answer: SearchResult? {
        query.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 ? found : nil
    }
    /// About the RecipeHub recipe being opened: out of date, unavailable, or no nutrition yet (nil for other foods).
    public private(set) var recipeNote: String?
    /// The recipe opened has no nutrition: "Estimate with AI" fills it in for this entry.
    public private(set) var recipeNeedsEstimate = false
    /// AI estimates per serving, by RecipeHub recipe id: sent with the log (the server stores them AI-estimated).
    private var recipeEstimates: [Int: Nutrients] = [:]
    public private(set) var searching = false
    public private(set) var message: String?
    /// The food just logged ("Logged Banana"); the search is cleared for the next one (SPEC-16).
    public private(set) var lastLogged: String?
    /// The meal new portions start in (the time of day's meal, in the account's timezone).
    public var meal: Meal

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let dayStore: DayStore
    @ObservationIgnored private var searchNumber = 0
    @ObservationIgnored private var loadNumber = 0

    public static let unknownBarcode = "We don't know this barcode yet. Scan Food can read its label."

    /// `meal`: the meal it was opened for (a meal's Add in the Food Log); nil → the time of day's meal.
    public init(api: APIClient, dayStore: DayStore, meal: Meal? = nil, now: @escaping () -> Date = Date.init) {
        self.api = api
        self.dayStore = dayStore
        self.meal = meal ?? Meal.suggested(at: now(), in: dayStore.zone)
    }

    public func load() async {
        loadNumber += 1
        let mine = loadNumber
        let day = dayStore.selected
        let meal = meal
        async let y = try? api.send(LogAPI.day(DayMath.add(-1, to: day)))
        async let s = try? api.send(FoodAPI.sameAsYesterday(day: day, meal: meal))
        async let f = try? api.send(FoodAPI.favorites())
        async let r = try? api.send(FoodAPI.recent(meal: meal))
        let (yesterdayDay, sameFoods, favoriteList, recentList) = await (y, s, f, r)
        // A newer load (another meal or day) took over while this one waited: keep what it shows
        guard mine == loadNumber else { return }
        let foods = sameFoods?.foods ?? []
        yesterday = (yesterdayDay?.entries ?? []).filter { $0.meal == meal }.map { entry in
            YesterdayItem(entry: entry, food: entry.sourceRef.flatMap { ref in foods.first { Self.same($0, ref) } })
        }
        favorites = favoriteList?.foods ?? []
        recent = recentList?.foods ?? []
    }

    /// The food stands for that stored ref: itself, or the database food it corrects.
    static func same(_ food: Food, _ ref: String) -> Bool {
        food.ref == ref || food.baseCacheId.map { "cache:\($0)" == ref } == true
    }

    /// A typed barcode: digits only, 8 to 14 of them.
    static func isBarcode(_ text: String) -> Bool {
        (8...14).contains(text.count) && text.allSatisfy(\.isASCII) && text.allSatisfy(\.isNumber)
    }

    public func search() async {
        searchNumber += 1
        let mine = searchNumber
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        message = nil
        guard q.count >= 2 else {
            groups = []
            found = nil
            searching = false
            return
        }
        searching = true
        defer { if mine == searchNumber { searching = false } }
        do {
            if Self.isBarcode(q) {
                let hit = try await api.send(FoodAPI.barcode(q))
                guard mine == searchNumber else { return }
                if let food = hit.food {
                    groups = [FoodGroup(source: "barcode", label: "Barcode \(hit.code)", foods: [food])]
                    found = SearchResult(groups: groups, errors: [])
                } else {
                    groups = []
                    found = nil
                    message = Self.unknownBarcode
                }
            } else {
                let result = try await api.send(FoodAPI.search(q))
                guard mine == searchNumber else { return }
                groups = result.groups.filter { !$0.foods.isEmpty }
                // Kept even when nothing was found: a source that failed still shows on its chip
                found = SearchResult(groups: groups, errors: result.errors, suggestion: result.suggestion, searched: result.searched)
                if groups.isEmpty { message = "Nothing found for “\(q)”" }
            }
        } catch is CancellationError {
            return // a newer keystroke took over: keep what's showing
        } catch {
            guard mine == searchNumber else { return }
            groups = []
            found = nil
            message = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    /// +: logs the food at the amount it was last logged at, else at its package serving (2 tbsp, 1 slice).
    public func quickLog(_ food: Food) async -> Bool {
        guard food.isLoggable else { return false }
        let last = food.startingAmount
        let unit = AmountUnit(rawValue: last.unit) ?? .serving
        return await logged(food.name) {
            _ = try await self.api.send(FoodAPI.log(food: food, day: self.dayStore.selected, meal: self.meal, servingIndex: last.servingIndex, unit: unit, quantity: last.quantity * last.fraction, estimate: self.estimate(for: food)))
        }
    }

    /// + on a Same as yesterday row: that entry, exactly as logged, copied into this day and meal.
    public func copyYesterday(_ item: YesterdayItem) async -> Bool {
        await copy([item.entry], name: item.entry.name)
    }

    /// Log all: every one of yesterday's entries for this meal.
    public func logAllYesterday() async -> Bool {
        guard !yesterday.isEmpty else { return false }
        return await copy(yesterday.map(\.entry), name: yesterday.count == 1 ? yesterday[0].entry.name : "\(yesterday.count) foods")
    }

    private func copy(_ entries: [LogEntry], name: String) async -> Bool {
        await logged(name) {
            _ = try await self.api.send(LogAPI.move(ids: entries.map(\.id), day: self.dayStore.selected, meal: self.meal, copy: true))
        }
    }

    private func logged(_ name: String, _ send: () async throws -> Void) async -> Bool {
        do {
            try await send()
            message = nil
            lastLogged = name
            await dayStore.reload()
            await load() // Recent changes
            return true
        } catch {
            message = (error as? APIError)?.message ?? error.localizedDescription
            return false
        }
    }

    /// Photo or Describe, opened inside Track Food, logged: back on the search with "Logged …", lists fresh.
    public func loggedElsewhere(_ name: String) async {
        message = nil
        lastLogged = name
        await dayStore.reload()
        await load()
    }

    public func clearMessage() { message = nil }

    private func estimate(for food: Food) -> Nutrients? { food.isCulury ? recipeEstimates[food.id] : nil }

    /// A RecipeHub recipe, read live (as the web does) before its amount screen opens. RecipeHub down: the copy already
    /// in hand, which the server also falls back to when logging.
    public func openRecipe(_ food: Food) async -> Food {
        recipeNote = nil
        recipeNeedsEstimate = false
        guard food.isCulury else { return food }
        do {
            let recipe = try await api.send(FoodAPI.culuryRecipe(food.id))
            if !recipe.hasNutrition {
                recipeNeedsEstimate = recipeEstimates[food.id] == nil
                recipeNote = recipeNeedsEstimate ? "RecipeHub has no nutrition for this recipe. Estimate it, or track it as unknown." : "The nutrition is an AI estimate for one serving; it's logged marked as AI-estimated."
                return recipeEstimates[food.id].map { recipe.food.with(nutrients: $0) } ?? recipe.food
            }
            if recipe.outdated { recipeNote = "RecipeHub's nutrition for this recipe may be out of date." }
            return recipe.food
        } catch {
            recipeNote = "RecipeHub is unavailable — using the last logged version"
            return food
        }
    }

    /// "Estimate with AI" for a recipe with no nutrition: the AI's guess for one serving, scaled to the recipe's
    /// serving weight when both are weighed. Nil (with a message) when the AI can't.
    public func estimateRecipe(_ food: Food) async -> Food? {
        let grams = food.servings.first?.grams
        let ask = "1 serving of \(food.name)" + (grams.map { " (\(Int($0.rounded())) g)" } ?? "")
        do {
            let out = try await api.send(FoodAPI.estimateItems(ask))
            guard let draft = out.items.first?.food else {
                message = "The AI couldn't estimate \(food.name)"
                return nil
            }
            var per = draft.nutrients
            if let grams, let theirs = draft.servings.first?.grams, theirs > 0 {
                per = Nutrients(per.values.mapValues { $0 * grams / theirs })
            }
            recipeEstimates[food.id] = per
            recipeNeedsEstimate = false
            recipeNote = "The nutrition is an AI estimate for one serving; it's logged marked as AI-estimated."
            return food.with(nutrients: per)
        } catch {
            message = (error as? APIError)?.message ?? error.localizedDescription
            return nil
        }
    }

    public func isFavorite(_ food: Food) -> Bool {
        favorites.contains { fav in
            fav.ref == food.ref || Self.same(fav, food.ref) || (fav.baseCacheId != nil && fav.baseCacheId == food.baseCacheId)
        }
    }

    /// The bookmark: on → stored; off → removed (with the database food it corrects, which may be how it's stored).
    /// Shown at once; put back with the message if the server says no.
    public func toggleFavorite(_ food: Food) async {
        let before = favorites
        let wasOn = isFavorite(food)
        let matches: (Food) -> Bool = { $0.ref == food.ref || Self.same($0, food.ref) || ($0.baseCacheId != nil && $0.baseCacheId == food.baseCacheId) }
        // Off: whatever is stored for it — the favorites it matched, the food itself, the database food it corrects
        var refs = favorites.filter(matches).map { ($0.kind, $0.id) } + [(food.kind, food.id)]
        if let base = food.baseCacheId { refs.append(("cache", base)) }
        favorites = wasOn ? favorites.filter { !matches($0) } : [food] + favorites
        do {
            if wasOn {
                var sent = Set<String>()
                for (kind, id) in refs where sent.insert("\(kind):\(id)").inserted {
                    _ = try await api.send(FoodAPI.removeFavorite(kind: kind, id: id))
                }
            } else {
                _ = try await api.send(FoodAPI.addFavorite(food))
            }
            message = nil
        } catch {
            favorites = before
            message = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    /// Logs the portion on the day being looked at; the day reloads. False (with a message) when the server says no.
    public func log(_ food: Food, portion: PortionModel) async -> Bool {
        guard portion.canLog else { return false }
        do {
            _ = try await api.send(FoodAPI.log(food: food, day: dayStore.selected, meal: portion.meal, servingIndex: portion.servingIndex, unit: portion.unit, quantity: portion.quantity, estimate: estimate(for: food)))
            message = nil
            lastLogged = food.name
            meal = portion.meal // the next food starts in the same meal
            query = ""
            groups = []
            found = nil
            await dayStore.reload()
            return true
        } catch {
            message = (error as? APIError)?.message ?? error.localizedDescription
            return false
        }
    }
}
