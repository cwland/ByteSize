import XCTest
@testable import ByteSizeKit

enum MyFoodFixtures {
    static func food(_ id: Int, _ name: String, kind: String = "custom", calories: Double = 200) -> String {
        #"{"kind":"user_food","id":\#(id),"name":"\#(name)","brand":null,"icon":"🍽️","barcode":null,"servings":[{"label":"1 serving","grams":100}],"nutrients":{"calories":\#(calories)},"aiFields":[],"imageUrl":null,"override":\#(kind == "override"),"source":"mine","foodKind":"\#(kind)"}"#
    }
    static func list(_ foods: String...) -> String { #"{"foods":[\#(foods.joined(separator: ","))]}"# }
    static func item(_ id: Int, _ name: String, calories: Double, quantity: Double = 1, available: Bool = true) -> String {
        #"{"food":{"kind":"cache","id":\#(id)},"foodKind":"custom","name":"\#(name)","brand":null,"icon":"🍳","imageUrl":null,"servingIndex":0,"unit":"serving","quantity":\#(quantity),"fraction":1,"servings":[{"label":"1 serving","grams":50}],"perServing":{"calories":\#(calories)},"nutrients":{"calories":\#(calories * quantity)},"available":\#(available)}"#
    }
    static func meal(_ items: String...) -> String {
        let base = food(90, "Usual breakfast", kind: "quick_meal", calories: 500).dropLast()
        return #"{"food":\#(base),"notes":null,"items":[\#(items.joined(separator: ","))],"recipeServings":null,"servingGrams":null}}"#
    }
    static let entries = #"{"entries":[],"combined":[]}"#
}

@MainActor
final class MyFoodsModelTests: XCTestCase {
    private let boise = TimeZone(identifier: "America/Boise")!
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    private let noon = ISO8601DateFormatter().date(from: "2026-11-19T19:00:00Z")!

    private func serve(_ reply: @escaping @Sendable (URLRequest) -> HTTPStub.Reply) {
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            switch (req.httpMethod ?? "", req.url?.path() ?? "") {
            case ("GET", "/api/my-foods"): return reply(req)
            case ("POST", "/api/log"): return .json(200, #"{"entry":{"id":5,"day":"2026-11-21","meal":"lunch","name":"Oat bars","brand":null,"icon":"🍽️","servingIndex":0,"unit":"serving","quantity":1,"fraction":1,"servings":[],"nutrients":{"calories":200},"aiEstimated":false,"source":"user_food"}}"#)
            case ("GET", _) where req.url!.path().hasPrefix("/api/day/"): return .json(200, Fixtures.day)
            case ("GET", "/api/days/logged"): return .json(200, #"{"days":[]}"#)
            default: return .json(404, #"{"error":"Not found"}"#)
            }
        }
    }

    private func model() -> (MyFoodsModel, DayStore) {
        let days = DayStore(api: api, timeZone: boise, now: { self.noon })
        return (MyFoodsModel(api: api, dayStore: days, now: { self.noon }), days)
    }

    private func query(of i: Int) -> [String: String] {
        let lists = HTTPStub.requests.filter { $0.request.url?.path() == "/api/my-foods" }
        let items = URLComponents(url: lists[i].request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        return Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
    }

    func testFiltersMapToTheServer() async {
        serve { _ in .json(200, MyFoodFixtures.list()) }
        let (m, _) = model()
        let expected: [(MyFoodsModel.Filter, String)] = [(.all, "all"), (.foods, "foods"), (.edits, "foods"), (.recipes, "recipes"), (.meals, "meals")]
        for (i, (filter, kind)) in expected.enumerated() {
            m.filter = filter
            await m.load()
            XCTAssertEqual(query(of: i)["kind"], kind, "\(filter)")
        }
        m.sort = .used
        await m.load()
        XCTAssertEqual(query(of: 5)["sort"], "used")
        XCTAssertNil(query(of: 5)["q"])
        XCTAssertEqual(MyFoodsModel.Filter.allCases.map(\.title), ["All", "Foods", "My edits", "Recipes", "Quick meals"])
        XCTAssertEqual(MyFoodsModel.Sort.allCases.map(\.title), ["Recent", "Most used", "A–Z"])
    }

    func testFoodsAndMyEditsSplitOverrides() async {
        serve { _ in .json(200, MyFoodFixtures.list(MyFoodFixtures.food(1, "Oat bars"), MyFoodFixtures.food(2, "Banana (mine)", kind: "override"))) }
        let (m, _) = model()
        m.filter = .foods
        await m.load()
        XCTAssertEqual(m.foods.map(\.name), ["Oat bars"])
        m.filter = .edits
        await m.load()
        XCTAssertEqual(m.foods.map(\.name), ["Banana (mine)"])
        m.filter = .all
        await m.load()
        XCTAssertEqual(m.foods.count, 2)
    }

    func testEmptyText() async {
        final class Box: @unchecked Sendable { var body = MyFoodFixtures.list() }
        let box = Box()
        serve { _ in .json(200, box.body) }
        let (m, _) = model()
        await m.load()
        XCTAssertEqual(m.emptyText, "Foods you create, correct or save as recipes on the web show up here")
        m.query = "zz"
        await m.load()
        XCTAssertEqual(m.emptyText, "No matches")
        XCTAssertEqual(query(of: 1)["q"], "zz")
        box.body = MyFoodFixtures.list(MyFoodFixtures.food(1, "Oat bars"))
        await m.load()
        XCTAssertNil(m.emptyText)
    }

    func testANewerSearchWins() async {
        serve { req in
            let q = URLComponents(url: req.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "q" }?.value
            return q == "ch"
                ? .delayed(0.4, .json(200, MyFoodFixtures.list(MyFoodFixtures.food(1, "Cherries"))))
                : .json(200, MyFoodFixtures.list(MyFoodFixtures.food(2, "Chicken")))
        }
        let (m, _) = model()
        m.query = "ch"
        async let slow: Void = m.load()
        try? await Task.sleep(for: .milliseconds(50))
        m.query = "chicken"
        await m.load()
        await slow
        XCTAssertEqual(m.foods.map(\.name), ["Chicken"])
    }

    func testLogSendsTheSelectedDay() async throws {
        serve { _ in .json(200, MyFoodFixtures.list()) }
        let (m, days) = model()
        await days.select("2026-11-17")
        let food = try JSONDecoder().decode(Food.self, from: Data(MyFoodFixtures.food(1, "Oat bars").utf8))
        let ok = await m.log(food, portion: PortionModel(food: food, meal: .lunch))
        XCTAssertTrue(ok)
        let post = HTTPStub.requests.first { $0.request.httpMethod == "POST" && $0.request.url?.path() == "/api/log" }
        XCTAssertEqual(post?.json?["day"] as? String, "2026-11-17")
        XCTAssertEqual(post?.json?["meal"] as? String, "lunch")
    }
}

@MainActor
final class QuickMealModelTests: XCTestCase {
    private let boise = TimeZone(identifier: "America/Boise")!
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    private let noon = ISO8601DateFormatter().date(from: "2026-11-19T19:00:00Z")!
    private static let three = MyFoodFixtures.meal(
        MyFoodFixtures.item(1, "Eggs", calories: 72, quantity: 2),
        MyFoodFixtures.item(2, "Toast", calories: 80),
        MyFoodFixtures.item(3, "Coffee", calories: 5)
    )

    private func serve(detail: String = three, log: HTTPStub.Reply = .json(200, MyFoodFixtures.entries)) {
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            switch (req.httpMethod ?? "", req.url?.path() ?? "") {
            case ("GET", "/api/my-foods/90"): return .json(200, detail)
            case ("POST", "/api/log/meal"): return log
            case ("GET", _) where req.url!.path().hasPrefix("/api/day/"): return .json(200, Fixtures.day)
            case ("GET", "/api/days/logged"): return .json(200, #"{"days":[]}"#)
            default: return .json(404, #"{"error":"Not found"}"#)
            }
        }
    }

    private func model() throws -> QuickMealModel {
        let days = DayStore(api: api, timeZone: boise, now: { self.noon })
        let food = try JSONDecoder().decode(Food.self, from: Data(MyFoodFixtures.food(90, "Usual breakfast", kind: "quick_meal", calories: 229).utf8))
        return QuickMealModel(api: api, dayStore: days, food: food, meal: .breakfast)
    }

    private var sent: [String: Any]? {
        HTTPStub.requests.first { $0.request.url?.path() == "/api/log/meal" }?.json
    }

    func testLoadsItemsAllIncluded() async throws {
        serve()
        let m = try model()
        await m.load()
        XCTAssertEqual(m.rows.count, 3)
        XCTAssertTrue(m.rows.allSatisfy(\.included))
        XCTAssertEqual(m.totalCalories, 144 + 80 + 5)
        XCTAssertTrue(m.canLog)
    }

    func testLeavingOneOutLogsTheRest() async throws {
        serve()
        let m = try model()
        await m.load()
        m.toggle(1)
        XCTAssertEqual(m.totalCalories, 149)
        let ok = await m.logAll()
        XCTAssertTrue(ok)
        let body = try XCTUnwrap(sent)
        XCTAssertEqual(body["foodId"] as? Int, 90)
        XCTAssertEqual(body["day"] as? String, "2026-11-19")
        XCTAssertEqual(body["meal"] as? String, "breakfast")
        let items = try XCTUnwrap(body["items"] as? [[String: Any]])
        XCTAssertEqual(items.compactMap { ($0["food"] as? [String: Any])?["id"] as? Int }, [1, 3])
        XCTAssertEqual(items[0]["quantity"] as? Double, 2)
        XCTAssertEqual(items[0]["unit"] as? String, "serving")
        XCTAssertEqual(items[0]["fraction"] as? Double, 1)
        XCTAssertEqual(items[0]["servingIndex"] as? Int, 0)
    }

    func testChangingAnAmountIsSent() async throws {
        serve()
        let m = try model()
        await m.load()
        m.rows[1].portion.whole = 2
        _ = await m.logAll()
        let items = try XCTUnwrap(sent?["items"] as? [[String: Any]])
        XCTAssertEqual(items[1]["quantity"] as? Double, 2)
    }

    func testNothingIncludedCantLog() async throws {
        serve()
        let m = try model()
        await m.load()
        for row in m.rows { m.toggle(row.id) }
        XCTAssertFalse(m.canLog)
        let ok = await m.logAll()
        XCTAssertFalse(ok)
        XCTAssertNil(sent)
    }

    func testAnArchivedItemStillLogs() async throws {
        serve(detail: MyFoodFixtures.meal(MyFoodFixtures.item(4, "Old granola", calories: 190, available: false)))
        let m = try model()
        await m.load()
        XCTAssertEqual(m.rows.count, 1)
        XCTAssertTrue(m.rows[0].included)
        _ = await m.logAll()
        let items = try XCTUnwrap(sent?["items"] as? [[String: Any]])
        XCTAssertEqual(items.count, 1)
    }

    func testServerErrorShowsMessage() async throws {
        serve(log: .json(400, #"{"error":"That meal has no foods left to log"}"#))
        let m = try model()
        await m.load()
        let ok = await m.logAll()
        XCTAssertFalse(ok)
        XCTAssertEqual(m.message, "That meal has no foods left to log")
    }
}
