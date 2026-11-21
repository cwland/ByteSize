import XCTest
@testable import ByteSizeKit

/// The web's source pills (§22, SourcePills.tsx viewOf) on the phone.
@MainActor
final class SourceFilterTests: XCTestCase {
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: "SourceFilterTests-\(UUID().uuidString)")
    }

    private func filter(_ account: String = "h|1") -> SourceFilter { SourceFilter(defaults: defaults, account: account) }

    /// A search answer: `groups` maps source → how many foods; `searched` nil leaves the field out.
    private func answer(_ groups: [(String, Int)], searched: [String]?, errors: [String] = []) throws -> SearchResult {
        let g = groups.map { source, n in
            #"{"source":"\#(source)","label":"\#(source)","foods":[\#(Array(repeating: FoodFixtures.banana, count: n).joined(separator: ","))]}"#
        }.joined(separator: ",")
        let e = errors.map { #"{"source":"\#($0)","message":"\#($0) failed"}"# }.joined(separator: ",")
        let s = searched.map { #","searched":[\#($0.map { "\"\($0)\"" }.joined(separator: ","))]"# } ?? ""
        return try JSONDecoder().decode(SearchResult.self, from: Data(#"{"groups":[\#(g)],"errors":[\#(e)]\#(s)}"#.utf8))
    }

    func testDefaultsMatchTheWeb() {
        let f = filter()
        XCTAssertEqual(f.choice, [.mine: true, .fatsecret: true, .basic: false, .usda: true, .off: true, .culury: false])
        XCTAssertFalse(f.open)
        XCTAssertEqual(SearchSource.allCases.map(\.label), ["My foods", "FatSecret", "Basic", "USDA", "Open Food Facts", "Culury"])
    }

    func testChipsFollowSearchedInWebOrder() throws {
        let v = filter().view(of: try answer([("mine", 2), ("usda", 3)], searched: ["usda", "mine", "basic"]))
        XCTAssertEqual(v.chips.map(\.source), [.mine, .basic, .usda])
        XCTAssertEqual(v.chips.map(\.count), [2, 0, 3])
        XCTAssertEqual(v.chips.map(\.on), [true, false, true])
    }

    func testAnOffChipHidesItsGroupButNotSavedFoods() throws {
        let f = filter()
        let found = try answer([("basic", 1), ("usda", 1), ("saved", 1)], searched: ["basic", "usda"])
        XCTAssertEqual(f.view(of: found).groups.map(\.source), ["usda", "saved"])
        f.toggle(.basic)
        XCTAssertEqual(f.view(of: found).groups.map(\.source), ["basic", "usda", "saved"])
    }

    func testNoSearchedShowsEverything() throws {
        let v = filter().view(of: try answer([("basic", 1), ("culury", 1)], searched: nil))
        XCTAssertEqual(v.chips, [])
        XCTAssertEqual(v.groups.map(\.source), ["basic", "culury"])
    }

    func testUSDAFailureMarksBasic() throws {
        let f = filter()
        let found = try answer([], searched: ["basic", "usda"], errors: ["usda"])
        XCTAssertEqual(f.view(of: found).chips.map(\.failed), [true, true])
        XCTAssertEqual(f.view(of: found).errors.map(\.source), ["usda"], "USDA is on")
        f.toggle(.usda) // both off now
        XCTAssertEqual(f.view(of: found).errors, [])
        f.toggle(.basic) // Basic on: its failure (USDA's) shows
        XCTAssertEqual(f.view(of: found).errors.map(\.source), ["usda"])
    }

    func testHintWhenTheOnesOnFoundNothing() throws {
        let v = filter().view(of: try answer([("mine", 0), ("basic", 4)], searched: ["mine", "basic"]))
        XCTAssertEqual(v.hint?.names, ["My foods"])
        XCTAssertEqual(v.hint?.more.source, .basic)
        XCTAssertEqual(v.hint?.more.count, 4)
        let none = filter().view(of: try answer([("mine", 1), ("basic", 4)], searched: ["mine", "basic"]))
        XCTAssertNil(none.hint, "My foods found one")
    }

    func testHintWithEveryChipOff() throws {
        let f = filter()
        f.toggle(.mine)
        let v = f.view(of: try answer([("basic", 4)], searched: ["mine", "basic"]))
        XCTAssertEqual(v.hint?.names, [])
        XCTAssertEqual(v.hint?.more.source, .basic)
    }

    func testChoiceAndOpenAreRememberedPerAccount() {
        let a = filter("h|1")
        a.toggle(.basic)
        a.open = true
        let again = filter("h|1")
        XCTAssertEqual(again.choice[.basic], true)
        XCTAssertTrue(again.open)
        let other = filter("h|2")
        XCTAssertEqual(other.choice[.basic], false)
        XCTAssertFalse(other.open)
    }

    func testJunkOrMissingKeysFallBackToDefaults() {
        defaults.set(Data(#"{"basic":true,"usda":"x"}"#.utf8), forKey: "sources.h|1.choice")
        let f = filter()
        XCTAssertEqual(f.choice, [.mine: true, .fatsecret: true, .basic: true, .usda: true, .off: true, .culury: false])
        defaults.set(Data("not json".utf8), forKey: "sources.h|1.choice")
        XCTAssertEqual(filter().choice[.basic], false)
    }

    func testSummaryCountsAskedSources() throws {
        let f = filter()
        XCTAssertEqual(f.summary(for: nil), "Show results from")
        let all = try answer([], searched: ["mine", "fatsecret", "basic", "usda", "off", "culury"])
        XCTAssertEqual(f.summary(for: all), "Show results from · 4 of 6")
        XCTAssertEqual(f.summary(for: try answer([], searched: nil)), "Show results from")
    }
}
