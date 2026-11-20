import XCTest
@testable import ByteSizeKit

@MainActor
final class TrackFoodModelTests: XCTestCase {
    private let boise = TimeZone(identifier: "America/Boise")!
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    /// 8:00 in Boise: breakfast time.
    private let morning = ISO8601DateFormatter().date(from: "2026-11-19T15:00:00Z")!
    private static let entry = #"{"entry":{"id":30,"day":"2026-11-17","meal":"breakfast","name":"Banana","brand":null,"icon":"🍌","servingIndex":0,"unit":"serving","quantity":1,"fraction":1,"servings":[{"label":"1 medium","grams":118}],"nutrients":{"calories":105},"aiEstimated":false,"source":"cache"}}"#

    private func serve(search: @escaping @Sendable (String) -> HTTPStub.Reply = { _ in .json(200, FoodFixtures.search) }, log: HTTPStub.Reply = .json(200, TrackFoodModelTests.entry)) {
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            let path = req.url?.path() ?? ""
            switch (req.httpMethod ?? "", path) {
            case ("GET", _) where path.hasPrefix("/api/day/"): return .json(200, Fixtures.day)
            case ("GET", "/api/days/logged"): return .json(200, #"{"days":[]}"#)
            case ("GET", "/api/foods/recent"): return .json(200, #"{"foods":[\#(FoodFixtures.banana)]}"#)
            case ("GET", "/api/foods/frequent"): return .json(200, #"{"foods":[\#(FoodFixtures.banana),\#(FoodFixtures.banana)]}"#)
            case ("GET", "/api/foods/search"):
                let q = URLComponents(url: req.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "q" }?.value ?? ""
                return search(q)
            case ("GET", "/api/foods/barcode/0012345678905"): return .json(200, #"{"code":"0012345678905","food":\#(FoodFixtures.banana),"errors":[]}"#)
            case ("GET", "/api/foods/barcode/0099999999999"): return .json(200, #"{"code":"0099999999999","food":null,"errors":[]}"#)
            case ("POST", "/api/log"): return log
            default: return .json(404, #"{"error":"Not found"}"#)
            }
        }
    }

    private func requests(_ method: String, _ path: String) -> [HTTPStub.Recorded] {
        HTTPStub.requests.filter { $0.request.httpMethod == method && $0.request.url?.path() == path }
    }

    private func model() -> (TrackFoodModel, DayStore) {
        let days = DayStore(api: api, timeZone: boise, now: { self.morning })
        return (TrackFoodModel(api: api, dayStore: days, now: { self.morning }), days)
    }

    func testLoadFetchesRecentAndFrequentForTheSuggestedMeal() async {
        serve()
        let (m, _) = model()
        XCTAssertEqual(m.meal, .breakfast)
        await m.load()
        XCTAssertEqual(m.recent.count, 1)
        XCTAssertEqual(m.frequent.count, 2)
        XCTAssertEqual(requests("GET", "/api/foods/recent").first?.request.url?.query(), "meal=breakfast")
        XCTAssertEqual(requests("GET", "/api/foods/frequent").first?.request.url?.query(), "meal=breakfast")
    }

    func testSearchNeedsTwoCharacters() async {
        serve()
        let (m, _) = model()
        m.query = "g"
        await m.search()
        XCTAssertTrue(requests("GET", "/api/foods/search").isEmpty)
        XCTAssertEqual(m.groups, [])
        m.query = "gr"
        await m.search()
        XCTAssertEqual(requests("GET", "/api/foods/search").count, 1)
        XCTAssertEqual(m.groups.map(\.label), ["Basic foods", "Culury"])
        XCTAssertFalse(m.searching)
        m.query = ""
        await m.search()
        XCTAssertEqual(m.groups, [], "clearing the field goes back to recent and frequent")
    }

    func testTypedBarcodeUsesTheBarcodeRoute() async {
        serve()
        let (m, _) = model()
        m.query = "0012345678905"
        await m.search()
        XCTAssertTrue(requests("GET", "/api/foods/search").isEmpty)
        XCTAssertEqual(m.groups.first?.foods.first?.name, "Banana")
        m.query = "0099999999999"
        await m.search()
        XCTAssertEqual(m.groups, [])
        XCTAssertEqual(m.message, "We don't know this barcode yet. Scan Food can read its label.")
    }

    func testTheLastSearchWins() async {
        let slow = #"{"groups":[{"source":"basic","label":"Old","foods":[\#(FoodFixtures.banana)]}],"errors":[]}"#
        let fast = #"{"groups":[{"source":"basic","label":"New","foods":[\#(FoodFixtures.banana)]}],"errors":[]}"#
        serve(search: { $0 == "ban" ? .delayed(0.4, .json(200, slow)) : .json(200, fast) })
        let (m, _) = model()
        m.query = "ban"
        let first = Task { await m.search() }
        try? await Task.sleep(for: .milliseconds(50))
        m.query = "bana"
        await m.search()
        await first.value
        XCTAssertEqual(m.groups.map(\.label), ["New"])
    }

    func testLogPostsTheSelectedDayAndThePortionsMeal() async throws {
        serve()
        let (m, days) = model()
        await days.select("2026-11-17") // not today
        let food = try JSONDecoder().decode(Food.self, from: Data(FoodFixtures.banana.utf8))
        let portion = PortionModel(food: food, meal: .breakfast)
        portion.meal = .dinner
        portion.whole = 2
        portion.fraction = 0.5
        let reloadsBefore = requests("GET", "/api/day/2026-11-17").count
        let ok = await m.log(food, portion: portion)
        XCTAssertTrue(ok)
        let body = try XCTUnwrap(requests("POST", "/api/log").last?.json)
        XCTAssertEqual(body["day"] as? String, "2026-11-17")
        XCTAssertEqual(body["meal"] as? String, "dinner")
        XCTAssertEqual(body["quantity"] as? Double, 2.5)
        XCTAssertEqual(body["fraction"] as? Double, 1)
        XCTAssertEqual(body["unit"] as? String, "serving")
        XCTAssertEqual(requests("GET", "/api/day/2026-11-17").count, reloadsBefore + 1, "the day reloads")
    }

    func testAServerNoIsShownAndNothingIsLogged() async throws {
        serve(log: .json(400, #"{"error":"Invalid request","details":[{"path":"quantity","message":"Enter an amount above 0"}]}"#))
        let (m, _) = model()
        let food = try JSONDecoder().decode(Food.self, from: Data(FoodFixtures.banana.utf8))
        let ok = await m.log(food, portion: PortionModel(food: food, meal: .lunch))
        XCTAssertFalse(ok)
        XCTAssertEqual(m.message, "Enter an amount above 0")
    }

    func testAPortionThatCantBeLoggedIsntSent() async throws {
        serve()
        let (m, _) = model()
        let food = try JSONDecoder().decode(Food.self, from: Data(FoodFixtures.banana.utf8))
        let portion = PortionModel(food: food, meal: .lunch)
        portion.whole = 0
        let ok = await m.log(food, portion: portion)
        XCTAssertFalse(ok)
        XCTAssertTrue(requests("POST", "/api/log").isEmpty)
    }

    func testATypedLetterCancellingTheLastSearchShowsNoError() async {
        serve(search: { $0 == "bana" ? .delayed(2, .json(200, FoodFixtures.search)) : .json(200, FoodFixtures.search) })
        let (m, _) = model()
        m.query = "ban"
        await m.search()
        XCTAssertEqual(m.groups.count, 2)
        m.query = "bana"
        let typing = Task { await m.search() }
        try? await Task.sleep(for: .milliseconds(100))
        typing.cancel() // the view's .task(id: query) does this on the next keystroke
        await typing.value
        XCTAssertNil(m.message, "no false 'can't reach' message")
        XCTAssertEqual(m.groups.count, 2, "the last results stay up")
    }

    func testGramsAreSentAsGrams() async throws {
        serve()
        let (m, _) = model()
        let food = try JSONDecoder().decode(Food.self, from: Data(FoodFixtures.banana.utf8))
        let portion = PortionModel(food: food, meal: .lunch)
        portion.choice = .unit(.g)
        portion.whole = 150
        _ = await m.log(food, portion: portion)
        let body = try XCTUnwrap(requests("POST", "/api/log").last?.json)
        XCTAssertEqual(body["unit"] as? String, "g")
        XCTAssertEqual(body["quantity"] as? Double, 150)
        XCTAssertEqual(body["servingIndex"] as? Int, 0)
    }

    func testAfterLoggingTheSearchIsReadyForTheNext() async throws {
        serve()
        let (m, _) = model()
        m.query = "banana"
        await m.search()
        let food = try JSONDecoder().decode(Food.self, from: Data(FoodFixtures.banana.utf8))
        let ok = await m.log(food, portion: PortionModel(food: food, meal: .lunch))
        XCTAssertTrue(ok)
        XCTAssertEqual(m.query, "")
        XCTAssertEqual(m.groups, [])
        XCTAssertEqual(m.lastLogged, "Banana")
    }
}
