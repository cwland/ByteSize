import XCTest
@testable import ByteSizeKit

@MainActor
final class EstimateModelTests: XCTestCase {
    private let denver = TimeZone(identifier: "America/Denver")!
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    private let morning = ISO8601DateFormatter().date(from: "2026-11-19T15:00:00Z")!
    private nonisolated static let twoItems = #"{"items":[\#(FoodFixtures.egg),\#(FoodFixtures.toast)],"assumed":false}"#

    private func serve(estimate: HTTPStub.Reply = .json(200, EstimateModelTests.twoItems), photo: @escaping @Sendable (String) -> HTTPStub.Reply = { _ in .json(200, #"{"photoIds":[],"errors":[],"labelReading":true}"#) }) {
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            let path = req.url?.path() ?? ""
            switch (req.httpMethod ?? "", path) {
            case ("GET", _) where path.hasPrefix("/api/day/"): return .json(200, Fixtures.day)
            case ("GET", "/api/days/logged"): return .json(200, #"{"days":[]}"#)
            case ("POST", "/api/ai/estimate-items"): return estimate
            case ("POST", "/api/log/estimates"): return .json(200, #"{"entries":[]}"#)
            case ("POST", "/api/my-foods"): return .json(200, #"{"food":{"kind":"user_food","id":9,"name":"Wheat crackers","brand":"Acme","icon":"🍘","barcode":null,"servings":[{"label":"2 crackers","grams":30}],"nutrients":{"calories":140},"aiFields":["calories"],"source":"mine","foodKind":"custom"}}"#)
            case ("POST", "/api/photos/analyze"):
                // URLSession hands uploads to the stub as a stream: the recorded copy has the bytes
                let body = String(decoding: req.httpBody ?? HTTPStub.requests.last?.body ?? Data(), as: UTF8.self)
                let mode = ["auto", "plate", "label", "barcode"].first { body.contains("name=\"mode\"\r\n\r\n\($0)\r\n") } ?? "?"
                return photo(mode)
            default: return .json(404, #"{"error":"Not found"}"#)
            }
        }
    }

    private func requests(_ method: String, _ path: String) -> [HTTPStub.Recorded] {
        HTTPStub.requests.filter { $0.request.httpMethod == method && $0.request.url?.path() == path }
    }

    private func model() -> (EstimateModel, DayStore) {
        let days = DayStore(api: api, timeZone: denver, now: { self.morning })
        return (EstimateModel(api: api, dayStore: days, now: { self.morning }), days)
    }

    func testDescribeListsTheFoods() async {
        serve()
        let (m, _) = model()
        XCTAssertEqual(m.meal, .breakfast)
        m.text = "2 eggs and toast"
        await m.describe()
        XCTAssertEqual(m.items.map(\.food.name), ["Egg, large", "Toast"])
        XCTAssertEqual(m.items[0].quantity, 2)
        XCTAssertEqual(m.totalCalories, 224) // 72 × 2 + 80
        XCTAssertNil(m.assumedNote)
        XCTAssertFalse(m.busy)
        XCTAssertEqual(requests("POST", "/api/ai/estimate-items").last?.json?["text"] as? String, "2 eggs and toast")
    }

    func testAGuessIsShown() async {
        serve(estimate: .json(200, #"{"items":[\#(FoodFixtures.toast)],"assumed":true,"interpretedAs":"Cheerios"}"#))
        let (m, _) = model()
        m.text = "cherios"
        await m.describe()
        XCTAssertEqual(m.assumedNote, "Took it as “Cheerios”")
    }

    func testTooShortAsksForMore() async {
        serve()
        let (m, _) = model()
        m.text = " a "
        await m.describe()
        XCTAssertTrue(requests("POST", "/api/ai/estimate-items").isEmpty)
        XCTAssertEqual(m.message, "Describe what you ate")
    }

    func testEditAndRemove() async {
        serve()
        let (m, _) = model()
        m.text = "2 eggs and toast"
        await m.describe()
        m.setQuantity(3, at: 0)
        XCTAssertEqual(m.items[0].quantity, 3)
        m.setQuantity(0, at: 0) // not an amount: unchanged
        XCTAssertEqual(m.items[0].quantity, 3)
        m.remove(at: 1)
        XCTAssertEqual(m.items.map(\.food.name), ["Egg, large"])
        m.remove(at: 5) // out of range: nothing happens
        XCTAssertEqual(m.items.count, 1)
    }

    func testLogAllPostsTheDayAndMealThenReloads() async throws {
        serve()
        let (m, days) = model()
        await days.select("2026-11-18")
        m.text = "2 eggs and toast"
        await m.describe()
        m.meal = .lunch
        let reloads = requests("GET", "/api/day/2026-11-18").count
        let ok = await m.logAll()
        XCTAssertTrue(ok)
        let body = try XCTUnwrap(requests("POST", "/api/log/estimates").last?.json)
        XCTAssertEqual(body["day"] as? String, "2026-11-18")
        XCTAssertEqual(body["meal"] as? String, "lunch")
        XCTAssertEqual((body["items"] as? [Any])?.count, 2)
        XCTAssertEqual(requests("GET", "/api/day/2026-11-18").count, reloads + 1)
        XCTAssertEqual(m.items, [])
        XCTAssertEqual(m.text, "")
    }

    func testLogAllWithNothingDoesNothing() async {
        serve()
        let (m, _) = model()
        let ok = await m.logAll()
        XCTAssertFalse(ok)
        XCTAssertTrue(requests("POST", "/api/log/estimates").isEmpty)
    }

    func testNoAIServiceKeepsTheText() async {
        serve(estimate: .json(503, #"{"error":"AI is turned off"}"#))
        let (m, _) = model()
        m.text = "2 eggs and toast"
        await m.describe()
        XCTAssertEqual(m.message, "Describe Food needs an AI service — set one up in the web app")
        XCTAssertEqual(m.text, "2 eggs and toast")
        XCTAssertEqual(m.items, [])
    }

    func testTheAIHasNoIdea() async {
        serve(estimate: .json(422, #"{"error":"Couldn't work out what that is. Try describing it differently."}"#))
        let (m, _) = model()
        m.text = "zxqv blorp"
        await m.describe()
        XCTAssertEqual(m.message, "Couldn't work out what that is. Try describing it differently.")
        XCTAssertEqual(m.text, "zxqv blorp")
    }

    func testPhotoOfABarcodeFindsTheFood() async {
        serve(photo: { _ in .json(200, #"{"photoIds":["p1"],"barcode":"0012345678905","food":\#(FoodFixtures.banana),"errors":[],"labelReading":true}"#) })
        let (m, _) = model()
        let outcome = await m.photo(jpeg: Data([1]))
        guard case .food(let food) = outcome else { return XCTFail("\(outcome)") }
        XCTAssertEqual(food.name, "Banana")
        XCTAssertEqual(requests("POST", "/api/photos/analyze").count, 1)
    }

    func testPhotoOfALabelIsADraft() async {
        serve(photo: { _ in .json(200, #"{"photoIds":["p1"],"draft":\#(FoodFixtures.draft),"errors":[],"labelReading":true}"#) })
        let (m, _) = model()
        let outcome = await m.photo(jpeg: Data([1]))
        guard case .draft(let draft) = outcome else { return XCTFail("\(outcome)") }
        XCTAssertEqual(draft.name, "Wheat crackers")
    }

    func testPhotoOfAPlateListsItsFoods() async {
        serve(photo: { mode in
            mode == "plate"
                ? .json(200, #"{"photoIds":["p2"],"plate":{"items":[\#(FoodFixtures.egg),\#(FoodFixtures.toast)]},"errors":[],"labelReading":true}"#)
                : .json(200, #"{"photoIds":["p1"],"errors":[{"source":"ai","message":"No label"}],"labelReading":true}"#)
        })
        let (m, _) = model()
        let outcome = await m.photo(jpeg: Data([1]))
        XCTAssertEqual(outcome, .items)
        XCTAssertEqual(m.items.count, 2)
        XCTAssertEqual(requests("POST", "/api/photos/analyze").count, 2) // auto, then plate
    }

    func testPhotoWithNothingInIt() async {
        serve(photo: { mode in
            mode == "plate"
                ? .json(200, #"{"photoIds":["p2"],"plate":{"items":[]},"errors":[{"source":"ai","message":"Couldn't make out the food in that photo"}],"labelReading":true}"#)
                : .json(200, #"{"photoIds":["p1"],"errors":[],"labelReading":true}"#)
        })
        let (m, _) = model()
        let outcome = await m.photo(jpeg: Data([1]))
        XCTAssertEqual(outcome, .nothing)
        XCTAssertEqual(m.message, "Couldn't make out the food in that photo")
    }

    func testPhotoWithoutAPhotoAI() async {
        serve(photo: { _ in .json(200, #"{"photoIds":["p1"],"errors":[],"labelReading":false}"#) })
        let (m, _) = model()
        let outcome = await m.photo(jpeg: Data([1]))
        XCTAssertEqual(outcome, .nothing)
        XCTAssertEqual(m.message, EstimateModel.needsPhotoAI)
        XCTAssertEqual(requests("POST", "/api/photos/analyze").count, 1, "no point asking for a plate")
    }

    func testALabelFromAPhotoIsSavedWithoutABarcode() async throws {
        serve()
        let (m, _) = model()
        let draft = try JSONDecoder().decode(AiDraft.self, from: Data(FoodFixtures.draft.utf8))
        let food = await m.save(draft)
        XCTAssertEqual(food?.ref, "user_food:9")
        let body = try XCTUnwrap(requests("POST", "/api/my-foods").last?.json)
        XCTAssertTrue(body["barcode"] == nil || body["barcode"] is NSNull)
        XCTAssertEqual(body["photoId"] as? String, "p1")
    }

    func testAnItemsServingAndAmount() async {
        serve()
        let (m, _) = model()
        m.text = "2 eggs and toast"
        await m.describe()
        m.setPortion(servingIndex: 0, quantity: 3.5, at: 0)
        XCTAssertEqual(m.items[0].quantity, 3.5)
        m.setPortion(servingIndex: 4, quantity: 1, at: 0) // not one of its servings: unchanged
        XCTAssertEqual(m.items[0].quantity, 3.5)
    }

    func testAFailedReEstimateClearsTheOldList() async {
        serve()
        let (m, _) = model()
        m.text = "2 eggs and toast"
        await m.describe()
        XCTAssertEqual(m.items.count, 2)
        serve(estimate: .json(502, #"{"error":"The AI couldn't estimate that. Try again, or describe it differently."}"#))
        m.text = "something else"
        await m.describe()
        XCTAssertEqual(m.items, [], "no list from the old description under the new error")
        XCTAssertNotNil(m.message)
    }
}
