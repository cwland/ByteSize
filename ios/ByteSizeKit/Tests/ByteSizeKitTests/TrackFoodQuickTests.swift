import XCTest
@testable import ByteSizeKit

/// L2 (SPEC-10): Same as yesterday, Favorites and Recently tracked; one-tap + logging; Log all; the bookmark.
@MainActor
final class TrackFoodQuickTests: XCTestCase {
    private let denver = TimeZone(identifier: "America/Denver")!
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    /// 8:00 in Denver on 2026-11-19: breakfast time.
    private let morning = ISO8601DateFormatter().date(from: "2026-11-19T15:00:00Z")!

    static func entry(_ id: Int, _ day: String, _ meal: String, _ name: String, sourceRef: String?) -> String {
        let ref = sourceRef.map { "\"\($0)\"" } ?? "null"
        return #"{"id":\#(id),"day":"\#(day)","meal":"\#(meal)","name":"\#(name)","brand":null,"icon":"🍽️","servingIndex":0,"unit":"serving","quantity":1,"fraction":1,"servings":[{"label":"1 cup"}],"nutrients":{"calories":150},"aiEstimated":\#(sourceRef == nil),"source":"cache","sourceRef":\#(ref),"treat":false}"#
    }

    static func day(_ day: String, _ entries: [String]) -> String {
        #"{"day":"\#(day)","entries":[\#(entries.joined(separator: ","))],"totals":{},"meals":{},"targets":null,"streak":0}"#
    }

    static let oatmeal = #"{"kind":"cache","id":50,"name":"Oatmeal","brand":null,"icon":"🥣","barcode":null,"servings":[{"label":"1 cup","grams":234}],"nutrients":{"calories":150},"aiFields":[],"source":"usda","foodKind":"custom","last":{"servingIndex":0,"unit":"serving","quantity":1,"fraction":1}}"#
    static let prunes = #"{"kind":"cache","id":42,"name":"Prunes","brand":null,"icon":"🍇","barcode":null,"servings":[{"label":"5 prunes","grams":40},{"label":"1 prune","grams":8,"derived":true}],"nutrients":{"calories":150},"aiFields":[],"source":"usda","foodKind":"custom","last":{"servingIndex":1,"unit":"serving","quantity":6,"fraction":1}}"#
    /// Alex's own correction of database food 42.
    static let prunesFixed = #"{"kind":"user_food","id":9,"name":"Prunes","brand":null,"icon":"🍇","barcode":null,"servings":[{"label":"5 prunes","grams":40}],"nutrients":{"calories":140},"aiFields":[],"source":"mine","foodKind":"override","baseCacheId":42}"#

    /// Yesterday (2026-11-18 when 2026-11-19 is selected) had two lunch entries: Oatmeal (a food) and an AI plate.
    private func serve(favorites: [String] = [], favoritePut: HTTPStub.Reply = .json(200, #"{"refs":["cache:42"]}"#)) {
        HTTPStub.requests = []
        let yesterdayLunch = [Self.entry(70, "2026-11-18", "lunch", "Oatmeal", sourceRef: "cache:50"), Self.entry(71, "2026-11-18", "lunch", "Plate estimate", sourceRef: nil), Self.entry(72, "2026-11-18", "dinner", "Soup", sourceRef: "cache:60")]
        let favs = favorites
        HTTPStub.handler = { req in
            let path = req.url?.path() ?? ""
            switch (req.httpMethod ?? "", path) {
            case ("GET", "/api/day/2026-11-18"): return .json(200, Self.day("2026-11-18", yesterdayLunch))
            case ("GET", "/api/day/2026-11-17"): return .json(200, Self.day("2026-11-17", []))
            case ("GET", _) where path.hasPrefix("/api/day/"): return .json(200, Self.day("2026-11-19", []))
            case ("GET", "/api/days/logged"): return .json(200, #"{"days":[]}"#)
            case ("GET", "/api/foods/same-as-yesterday"): return .json(200, #"{"foods":[\#(Self.oatmeal)]}"#)
            case ("GET", "/api/foods/favorites"): return .json(200, #"{"foods":[\#(favs.joined(separator: ","))]}"#)
            case ("GET", "/api/foods/recent"): return .json(200, #"{"foods":[\#(FoodFixtures.banana)]}"#)
            case ("PUT", "/api/foods/favorites"): return favoritePut
            case ("DELETE", _) where path.hasPrefix("/api/foods/favorites/"): return .json(200, #"{"refs":[]}"#)
            case ("POST", "/api/log"): return .json(200, #"{"entry":\#(Self.entry(80, "2026-11-19", "lunch", "Prunes", sourceRef: "cache:42"))}"#)
            case ("POST", "/api/log/move"): return .json(200, #"{"entries":[]}"#)
            default: return .json(404, #"{"error":"Not found"}"#)
            }
        }
    }

    private func requests(_ method: String, _ path: String) -> [HTTPStub.Recorded] {
        HTTPStub.requests.filter { $0.request.httpMethod == method && $0.request.url?.path() == path }
    }

    private func body(_ r: HTTPStub.Recorded) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(r.body)) as? [String: Any])
    }

    private func model(meal: Meal? = .lunch) -> (TrackFoodModel, DayStore) {
        let days = DayStore(api: api, timeZone: denver, now: { self.morning })
        return (TrackFoodModel(api: api, dayStore: days, meal: meal, now: { self.morning }), days)
    }

    private func food(_ json: String) throws -> Food { try JSONDecoder().decode(Food.self, from: Data(json.utf8)) }

    func testQuickSectionsLoadForTheMealAndTheDayBeforeTheSelectedOne() async {
        serve(favorites: [Self.prunes])
        let (m, _) = model()
        await m.load()
        XCTAssertEqual(m.yesterday.map(\.entry.name), ["Oatmeal", "Plate estimate"], "only that meal's entries")
        XCTAssertEqual(m.yesterday.first?.food?.name, "Oatmeal")
        XCTAssertEqual(m.favorites.map(\.name), ["Prunes"])
        XCTAssertEqual(m.recent.map(\.name), ["Banana"])
        XCTAssertEqual(requests("GET", "/api/foods/same-as-yesterday").first?.request.url?.query(), "day=2026-11-19&meal=lunch")
        XCTAssertTrue(requests("GET", "/api/foods/frequent").isEmpty)
    }

    func testAnEarlierSelectedDayUsesTheDayBeforeThat() async {
        serve()
        let (m, days) = model()
        await days.select("2026-11-18")
        await m.load()
        XCTAssertEqual(requests("GET", "/api/day/2026-11-17").count, 1)
        XCTAssertEqual(m.yesterday, [])
        let item = YesterdayItem(entry: try! JSONDecoder().decode(LogEntry.self, from: Data(Self.entry(70, "2026-11-17", "lunch", "Oatmeal", sourceRef: "cache:50").utf8)), food: nil)
        _ = await m.copyYesterday(item)
        let move = try! body(XCTUnwrap(requests("POST", "/api/log/move").first))
        XCTAssertEqual(move["day"] as? String, "2026-11-18", "lands on the day being looked at")
    }

    func testAnEntryWithoutAFoodIsStillShownButHasNoFood() async {
        serve()
        let (m, _) = model()
        await m.load()
        XCTAssertEqual(m.yesterday.last?.entry.name, "Plate estimate")
        XCTAssertNil(m.yesterday.last?.food)
    }

    func testPlusLogsAtTheLastAmount() async throws {
        serve()
        let (m, _) = model()
        let ok = await m.quickLog(try food(Self.prunes))
        XCTAssertTrue(ok)
        let sent = try body(XCTUnwrap(requests("POST", "/api/log").first))
        XCTAssertEqual(sent["servingIndex"] as? Int, 1)
        XCTAssertEqual(sent["unit"] as? String, "serving")
        XCTAssertEqual(sent["quantity"] as? Double, 6)
        XCTAssertEqual(sent["day"] as? String, "2026-11-19")
        XCTAssertEqual(sent["meal"] as? String, "lunch")
        XCTAssertEqual(m.lastLogged, "Prunes")
    }

    func testCopyingOneOfYesterdaysEntries() async throws {
        serve()
        let (m, _) = model()
        await m.load()
        let ok = await m.copyYesterday(try XCTUnwrap(m.yesterday.first))
        XCTAssertTrue(ok)
        let move = try body(XCTUnwrap(requests("POST", "/api/log/move").first))
        XCTAssertEqual(move["ids"] as? [Int], [70])
        XCTAssertEqual(move["day"] as? String, "2026-11-19")
        XCTAssertEqual(move["meal"] as? String, "lunch")
        XCTAssertEqual(move["copy"] as? Bool, true)
        XCTAssertEqual(m.lastLogged, "Oatmeal")
    }

    func testLogAllCopiesEveryEntryOfThatMeal() async throws {
        serve()
        let (m, _) = model()
        await m.load()
        let ok = await m.logAllYesterday()
        XCTAssertTrue(ok)
        let moves = requests("POST", "/api/log/move")
        XCTAssertEqual(moves.count, 1)
        XCTAssertEqual(try body(moves[0])["ids"] as? [Int], [70, 71])
        XCTAssertEqual(m.lastLogged, "2 foods")
    }

    func testAMealGivenWhenOpeningWinsOverTheTimeOfDay() {
        serve()
        XCTAssertEqual(model(meal: .lunch).0.meal, .lunch)
        XCTAssertEqual(model(meal: nil).0.meal, .breakfast, "8 am without a meal: breakfast")
    }

    func testBookmarkAddsAndRemoves() async throws {
        serve()
        let (m, _) = model()
        let prunes = try food(Self.prunes)
        XCTAssertFalse(m.isFavorite(prunes))
        await m.toggleFavorite(prunes)
        XCTAssertTrue(m.isFavorite(prunes))
        let put = try body(XCTUnwrap(requests("PUT", "/api/foods/favorites").first))
        XCTAssertEqual((put["food"] as? [String: Any])?["kind"] as? String, "cache")
        XCTAssertEqual((put["food"] as? [String: Any])?["id"] as? Int, 42)
        await m.toggleFavorite(prunes)
        XCTAssertFalse(m.isFavorite(prunes))
        XCTAssertEqual(requests("DELETE", "/api/foods/favorites/cache/42").count, 1)
    }

    func testUnbookmarkingACorrectionRemovesTheStoredFavorite() async throws {
        serve(favorites: [Self.prunesFixed])
        let (m, _) = model()
        await m.load()
        let database = try food(Self.prunes)
        XCTAssertTrue(m.isFavorite(database), "a database favorite shown as its correction")
        XCTAssertTrue(m.isFavorite(try food(Self.prunesFixed)))
        await m.toggleFavorite(try food(Self.prunesFixed))
        XCTAssertEqual(requests("DELETE", "/api/foods/favorites/user_food/9").count, 1)
        XCTAssertEqual(requests("DELETE", "/api/foods/favorites/cache/42").count, 1)
        XCTAssertFalse(m.isFavorite(database))
        XCTAssertEqual(m.favorites, [])
    }

    func testAFailedToggleGoesBack() async throws {
        serve(favoritePut: .json(500, #"{"error":"Something went wrong"}"#))
        let (m, _) = model()
        await m.load()
        let prunes = try food(Self.prunes)
        await m.toggleFavorite(prunes)
        XCTAssertFalse(m.isFavorite(prunes))
        XCTAssertEqual(m.favorites, [])
        XCTAssertNotNil(m.message)
    }
}
