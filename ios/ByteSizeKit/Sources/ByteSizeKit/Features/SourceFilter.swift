import Foundation
import Observation

/// One search source the person can show or hide (the web's §22 pills, in their order).
public enum SearchSource: String, CaseIterable, Sendable {
    case mine, fatsecret, basic, usda, off, culury

    public var label: String {
        switch self {
        case .mine: "My foods"
        case .fatsecret: "FatSecret"
        case .basic: "Basic"
        case .usda: "USDA"
        case .off: "Open Food Facts"
        case .culury: "RecipeHub"
        }
    }

    static let defaults: [SearchSource: Bool] = [.mine: true, .fatsecret: true, .basic: false, .usda: true, .off: true, .culury: false]
}

public struct SourceChip: Equatable, Identifiable, Sendable {
    public let source: SearchSource
    public let on: Bool
    public let count: Int
    public let failed: Bool
    public var id: String { source.rawValue }
}

/// "Nothing in My foods — Basic has 4": the sources on found nothing, one that's off did.
public struct SourceHint: Equatable, Sendable {
    public let names: [String]
    public let more: SourceChip
}

public struct SourceView: Equatable, Sendable {
    public let chips: [SourceChip]
    public let groups: [FoodGroup]
    public let errors: [SourceError]
    public let hint: SourceHint?
}

/// Which sources Track Food shows, and whether the "Show results from" row is open.
/// Both are remembered on this phone for each account. Filtering is local: no new search.
@MainActor @Observable
public final class SourceFilter {
    public private(set) var choice: [SearchSource: Bool]
    public var open: Bool {
        didSet { defaults.set(open, forKey: openKey) }
    }

    private let defaults: UserDefaults
    private let choiceKey: String
    private let openKey: String

    public init(defaults: UserDefaults, account: String) {
        self.defaults = defaults
        choiceKey = "sources.\(account).choice"
        openKey = "sources.\(account).open"
        open = defaults.bool(forKey: openKey)
        choice = SearchSource.defaults
        // An old or broken saved choice: keep what's readable, the default for the rest
        if let data = defaults.data(forKey: choiceKey),
           let saved = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            for source in SearchSource.allCases {
                if let on = saved[source.rawValue] as? Bool { choice[source] = on }
            }
        }
    }

    public func toggle(_ source: SearchSource) {
        choice[source] = !(choice[source] ?? false)
        let raw = Dictionary(uniqueKeysWithValues: choice.map { ($0.key.rawValue, $0.value) })
        if let data = try? JSONSerialization.data(withJSONObject: raw) { defaults.set(data, forKey: choiceKey) }
    }

    private func isOn(_ source: SearchSource) -> Bool { choice[source] ?? false }

    public func view(of found: SearchResult) -> SourceView {
        guard let searched = found.searched else {
            return SourceView(chips: [], groups: found.groups, errors: found.errors, hint: nil)
        }
        let asked = SearchSource.allCases.filter { searched.contains($0.rawValue) }
        var failed = Set(found.errors.map(\.source))
        if failed.contains(SearchSource.usda.rawValue) { failed.insert(SearchSource.basic.rawValue) } // one call feeds both
        let chips = asked.map { s in
            SourceChip(source: s, on: isOn(s), count: found.groups.first { $0.source == s.rawValue }?.foods.count ?? 0,
                       failed: failed.contains(s.rawValue))
        }
        // A chip source's group shows only while its chip is on; others (saved foods) always show
        let groups = found.groups.filter { g in
            guard let s = SearchSource(rawValue: g.source) else { return true }
            return asked.contains(s) && isOn(s)
        }
        let errors = found.errors.filter { e in
            guard let s = SearchSource(rawValue: e.source), asked.contains(s) else { return true }
            return isOn(s) || (s == .usda && isOn(.basic))
        }
        let on = chips.filter(\.on)
        var hint: SourceHint?
        if let more = chips.first(where: { !$0.on && $0.count > 0 }), on.allSatisfy({ $0.count == 0 }) {
            hint = SourceHint(names: on.map(\.source.label), more: more)
        }
        return SourceView(chips: chips, groups: groups, errors: errors, hint: hint)
    }

    public func summary(for found: SearchResult?) -> String {
        guard let searched = found?.searched else { return "Show results from" }
        let asked = SearchSource.allCases.filter { searched.contains($0.rawValue) }
        return "Show results from · \(asked.filter(isOn).count) of \(asked.count)"
    }
}
