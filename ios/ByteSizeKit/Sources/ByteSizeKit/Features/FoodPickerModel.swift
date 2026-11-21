import Foundation
import Observation

/// "Add ingredient" / "Add food": a food search for the recipe and quick meal editors. Only foods an item can point at
/// (database foods and the person's own), and only those the editor allows.
@MainActor
@Observable
public final class FoodPickerModel {
    public var query = ""
    public private(set) var results: [Food] = []
    public private(set) var searching = false
    public private(set) var message: String?

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let allowed: (Food) -> Bool
    @ObservationIgnored private var searchNumber = 0

    public init(api: APIClient, allowed: @escaping (Food) -> Bool) {
        self.api = api
        self.allowed = allowed
    }

    public func search() async {
        searchNumber += 1
        let mine = searchNumber
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else {
            results = []
            message = nil
            searching = false
            return
        }
        searching = true
        defer { if mine == searchNumber { searching = false } }
        do {
            let out = try await api.send(FoodAPI.search(q))
            guard mine == searchNumber else { return }
            results = out.groups.flatMap(\.foods).filter { ($0.kind == "cache" || $0.kind == "user_food") && allowed($0) }
            message = results.isEmpty ? "Nothing found" : nil
        } catch is CancellationError {
            return // a newer keystroke took over (review I-3)
        } catch {
            guard mine == searchNumber else { return }
            message = (error as? APIError)?.message ?? error.localizedDescription
        }
    }
}
