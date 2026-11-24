import XCTest
@testable import ByteSizeKit

/// Describe with several foods (2026-11-22 design): One meal (opens first) or Separate items; amounts change, foods
/// can be removed and added; the changes stay across the switch.
@MainActor
final class DescribeMealTests: XCTestCase {
    private let denver = TimeZone(identifier: "America/Denver")!
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    private let morning = ISO8601DateFormatter().date(from: "2026-11-19T15:00:00Z")!
    private nonisolated static let meal = #"{"items":[\#(FoodFixtures.egg),\#(FoodFixtures.toast)],"mealName":"Eggs and toast","assumed":false}"#
    private nonisolated static let single = #"{"items":[\#(FoodFixtures.egg)],"mealName":null,"assumed":false}"#
    private nonisolated static let coffee = #"{"items":[{"food":{"name":"Coffee","brand":null,"category":"coffee","icon":"☕️","barcode":null,"servings":[{"label":"1 cup","ml":240}],"nutrients":{"calories":2},"aiFields":["calories"],"imageUrl":null,"override":false,"source":"ai"},"servingIndex":0,"quantity":1}],"mealName":null,"assumed":false}"#

    private func serve(_ answers: [String]) {
        HTTPStub.requests = []
        let queue = Queue(answers)
        HTTPStub.handler = { req in
            let path = req.url?.path() ?? ""
            switch (req.httpMethod ?? "", path) {
            case ("GET", _) where path.hasPrefix("/api/day/"): return .json(200, Fixtures.day)
            case ("GET", "/api/days/logged"): return .json(200, #"{"days":[]}"#)
            case ("POST", "/api/ai/estimate-items"): return .json(200, queue.next())
            case ("POST", "/api/log/estimates"): return .json(200, #"{"entries":[]}"#)
            default: return .json(404, #"{"error":"Not found"}"#)
            }
        }
    }

    private final class Queue: @unchecked Sendable {
        private var list: [String]
        private let lock = NSLock()
        init(_ list: [String]) { self.list = list }
        func next() -> String {
            lock.lock()
            defer { lock.unlock() }
            return list.count > 1 ? list.removeFirst() : list[0]
        }
    }

    private func logged() throws -> [String: Any] {
        try XCTUnwrap(HTTPStub.requests.last { $0.request.httpMethod == "POST" && $0.request.url?.path() == "/api/log/estimates" }?.json)
    }

    private func described(_ answers: [String] = [DescribeMealTests.meal]) async -> EstimateModel {
        serve(answers)
        let days = DayStore(api: api, timeZone: denver, now: { self.morning })
        let m = EstimateModel(api: api, dayStore: days, now: { self.morning })
        m.text = "2 eggs and toast"
        await m.describe()
        return m
    }

    // 2026-11-23: several foods open on Separate items (each its own entry); One meal is still a tap away
    func testSeveralFoodsOpenOnSeparateItemsWithTheirName() async {
        let m = await described()
        XCTAssertTrue(m.showsSwitch)
        XCTAssertEqual(m.mode, .items)
        XCTAssertEqual(m.mealName, "Eggs and toast")
        XCTAssertFalse(m.saveToMyFoods)
        XCTAssertEqual(m.totalCalories, 224)
    }

    func testOneFoodHasNoSwitch() async {
        let m = await described([Self.single])
        XCTAssertFalse(m.showsSwitch)
        XCTAssertEqual(m.mode, .items)
    }

    func testOneMealLogsEveryFoodAsOneEntry() async throws {
        let m = await described()
        m.mode = .meal
        m.toggle(at: 1) // a check only counts in Separate items
        XCTAssertEqual(m.totalCalories, 224)
        XCTAssertTrue(m.canLog)
        let ok = await m.logSelected()
        XCTAssertTrue(ok)
        let body = try logged()
        XCTAssertEqual((body["items"] as? [[String: Any]])?.count, 2)
        let combine = try XCTUnwrap(body["combine"] as? [String: Any])
        XCTAssertEqual(combine["name"] as? String, "Eggs and toast")
        XCTAssertEqual(combine["save"] as? Bool, false)
    }

    // + on a row logs that food on its own; the list stays, with it marked logged and out of the total
    func testPlusLogsOneFoodOnItsOwn() async throws {
        let m = await described()
        let ok = await m.logOne(at: 0)
        XCTAssertTrue(ok)
        let body = try logged()
        XCTAssertNil(body["combine"])
        XCTAssertEqual((body["items"] as? [[String: Any]])?.map { $0["name"] as? String }, ["Egg, large"])
        XCTAssertEqual(m.items.count, 2, "the list stays for the rest")
        XCTAssertEqual(m.logged, [true, false])
        XCTAssertEqual(m.totalCalories, 80, "what's left: the toast")
        XCTAssertEqual(m.remainingCount, 1)
        XCTAssertFalse(await m.logOne(at: 0), "logged once is enough")
    }

    // Log all: every food not yet logged, each as its own entry
    func testLogAllLogsTheRestOneEntryEach() async throws {
        let m = await described()
        _ = await m.logOne(at: 0)
        let ok = await m.logSelected()
        XCTAssertTrue(ok)
        let body = try logged()
        XCTAssertNil(body["combine"])
        XCTAssertEqual((body["items"] as? [[String: Any]])?.map { $0["name"] as? String }, ["Toast"])
    }

    func testOneMealLeavesOutWhatWasAlreadyLogged() async throws {
        let m = await described()
        _ = await m.logOne(at: 0)
        m.mode = .meal
        XCTAssertEqual(m.totalCalories, 80)
        _ = await m.logSelected()
        XCTAssertEqual((try logged()["items"] as? [[String: Any]])?.map { $0["name"] as? String }, ["Toast"])
    }

    func testSeparateItemsLogsOnlyTheCheckedOnes() async throws {
        let m = await described()
        m.mode = .items
        m.toggle(at: 1)
        XCTAssertEqual(m.totalCalories, 144)
        _ = await m.logSelected()
        let body = try logged()
        XCTAssertNil(body["combine"])
        XCTAssertEqual((body["items"] as? [[String: Any]])?.map { $0["name"] as? String }, ["Egg, large"])
    }

    func testANewNameAndSaveGoWithTheMeal() async throws {
        let m = await described()
        m.mode = .meal
        m.mealName = "  "
        XCTAssertFalse(m.canLog, "One meal needs a name")
        m.mealName = "My breakfast"
        m.saveToMyFoods = true
        _ = await m.logSelected()
        let combine = try XCTUnwrap(try logged()["combine"] as? [String: Any])
        XCTAssertEqual(combine["name"] as? String, "My breakfast")
        XCTAssertEqual(combine["save"] as? Bool, true)
    }

    func testRemovingAndAmountsStayAcrossTheSwitch() async {
        let m = await described()
        m.setPortion(servingIndex: 0, quantity: 3, at: 0)
        m.remove(at: 1)
        XCTAssertEqual(m.items.map(\.food.name), ["Egg, large"])
        XCTAssertEqual(m.totalCalories, 216)
        m.mode = .items
        XCTAssertEqual(m.items[0].quantity, 3)
        XCTAssertEqual(m.totalCalories, 216)
        m.mode = .meal
        XCTAssertEqual(m.totalCalories, 216)
    }

    func testAddAFoodAsksTheAIAndAddsIt() async {
        let m = await described([Self.meal, Self.coffee])
        m.addText = "a black coffee"
        await m.addFood()
        XCTAssertEqual(m.items.map(\.food.name), ["Egg, large", "Toast", "Coffee"])
        XCTAssertEqual(m.addText, "")
        XCTAssertEqual(m.totalCalories, 226)
        XCTAssertEqual(HTTPStub.requests.last { $0.request.url?.path() == "/api/ai/estimate-items" }?.json?["text"] as? String, "a black coffee")
        XCTAssertTrue(m.showsSwitch, "the switch stays for the meal")
    }
}
