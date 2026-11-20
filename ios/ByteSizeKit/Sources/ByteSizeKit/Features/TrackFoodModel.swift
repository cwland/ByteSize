import Foundation
import Observation

/// Track Food: search (or a typed barcode), recent and frequent foods for the meal, then log a portion.
@MainActor
@Observable
public final class TrackFoodModel {
    public var query = ""
    public private(set) var recent: [Food] = []
    public private(set) var frequent: [Food] = []
    public private(set) var groups: [FoodGroup] = []
    public private(set) var searching = false
    public private(set) var message: String?
    /// The meal new portions start in (the time of day's meal, in the account's timezone).
    public var meal: Meal

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let dayStore: DayStore
    @ObservationIgnored private var searchNumber = 0

    public static let unknownBarcode = "We don't know this barcode yet. Scan Food can read its label."

    public init(api: APIClient, dayStore: DayStore, now: @escaping () -> Date = Date.init) {
        self.api = api
        self.dayStore = dayStore
        self.meal = Meal.suggested(at: now(), in: dayStore.zone)
    }

    public func load() async {
        async let r = try? api.send(FoodAPI.recent(meal: meal))
        async let f = try? api.send(FoodAPI.frequent(meal: meal))
        let (recentList, frequentList) = await (r, f)
        recent = recentList?.foods ?? []
        frequent = frequentList?.foods ?? []
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
                } else {
                    groups = []
                    message = Self.unknownBarcode
                }
            } else {
                let result = try await api.send(FoodAPI.search(q))
                guard mine == searchNumber else { return }
                groups = result.groups.filter { !$0.foods.isEmpty }
                if groups.isEmpty { message = "Nothing found for “\(q)”" }
            }
        } catch {
            guard mine == searchNumber else { return }
            groups = []
            message = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    /// Logs the portion on the day being looked at; the day reloads. False (with a message) when the server says no.
    public func log(_ food: Food, portion: PortionModel) async -> Bool {
        guard let quantity = portion.quantity, portion.canLog else { return false }
        do {
            _ = try await api.send(FoodAPI.log(food: food, day: dayStore.selected, meal: portion.meal, servingIndex: portion.servingIndex, quantity: quantity, fraction: portion.fraction))
            message = nil
            await dayStore.reload()
            return true
        } catch {
            message = (error as? APIError)?.message ?? error.localizedDescription
            return false
        }
    }
}
