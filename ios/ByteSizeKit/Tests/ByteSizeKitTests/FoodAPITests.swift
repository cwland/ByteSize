import XCTest
@testable import ByteSizeKit

/// JSON shapes copied from the server (lib/foods.ts FoodResult, routes/photos.ts AnalyzeResult, the I3 estimate routes).
enum FoodFixtures {
    static let banana = #"{"kind":"cache","id":41,"name":"Banana","brand":null,"icon":"🍌","barcode":null,"servings":[{"label":"1 medium","grams":118},{"label":"100 g","grams":100}],"nutrients":{"calories":105,"protein_g":1.3,"fiber_g":3.1},"aiFields":[],"imageUrl":null,"override":false,"source":"usda","foodKind":"custom","savedAt":null}"#
    static let culury = #"{"kind":"culury","id":7,"name":"Chili","brand":null,"icon":"🍲","barcode":null,"servings":[{"label":"1 bowl"}],"nutrients":{"calories":400},"aiFields":[],"imageUrl":null,"override":false,"source":"culury","foodKind":"recipe"}"#
    static let search = #"{"groups":[{"source":"basic","label":"Basic foods","foods":[\#(banana)]},{"source":"culury","label":"Culury","foods":[\#(culury)]}],"errors":[{"source":"usda","message":"USDA didn't answer"}],"searched":["basic","usda"],"suggestion":"Banana"}"#
    static let draft = #"{"name":"Wheat crackers","brand":"Acme","category":"crackers","icon":"🍘","barcode":null,"servings":[{"label":"2 crackers","grams":30}],"nutrients":{"calories":140,"protein_g":3,"fat_g":5},"aiFields":["calories","protein_g","fat_g"],"imageUrl":"/api/photos/p1?sig=x","override":false,"source":"ai","photoId":"p1"}"#
    static let egg = #"{"food":{"name":"Egg, large","brand":null,"category":"eggs","icon":"🥚","barcode":null,"servings":[{"label":"1 large egg","grams":50}],"nutrients":{"calories":72,"protein_g":6.3},"aiFields":["calories","protein_g"],"imageUrl":null,"override":false,"source":"ai"},"servingIndex":0,"quantity":2}"#
    static let toast = #"{"food":{"name":"Toast","brand":null,"category":"bread","icon":"🍞","barcode":null,"servings":[{"label":"1 slice","grams":30}],"nutrients":{"calories":80},"aiFields":["calories"],"imageUrl":null,"override":false,"source":"ai"},"servingIndex":0,"quantity":1}"#
}

final class FoodAPITests: XCTestCase {
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    private func sent() -> HTTPStub.Recorded { HTTPStub.requests.last! }

    func testSearchDecodesGroupsAndSendsTheQuery() async throws {
        HTTPStub.routes(["/api/foods/search": .json(200, FoodFixtures.search)])
        let r = try await api.send(FoodAPI.search("bana"))
        XCTAssertEqual(sent().request.url?.query(), "q=bana")
        XCTAssertEqual(r.groups.map(\.label), ["Basic foods", "Culury"])
        let banana = r.groups[0].foods[0]
        XCTAssertEqual(banana.ref, "cache:41")
        XCTAssertEqual(banana.servings[0], Serving(label: "1 medium", grams: 118))
        XCTAssertEqual(banana.nutrients["calories"], 105)
        XCTAssertTrue(banana.isLoggable)
        XCTAssertFalse(r.groups[1].foods[0].isLoggable) // Culury recipes are tracked in the web app
        XCTAssertEqual(r.errors.first?.message, "USDA didn't answer")
        XCTAssertEqual(r.suggestion, "Banana")
    }

    func testBarcodeRecentAndFrequent() async throws {
        HTTPStub.routes([
            "/api/foods/barcode/0012345678905": .json(200, #"{"code":"0012345678905","food":\#(FoodFixtures.banana),"errors":[]}"#),
            "/api/foods/barcode/0099999999999": .json(200, #"{"code":"0099999999999","food":null,"errors":[]}"#),
            "/api/foods/recent": .json(200, #"{"foods":[\#(FoodFixtures.banana)]}"#),
            "/api/foods/frequent": .json(200, #"{"foods":[]}"#),
        ])
        let found = try await api.send(FoodAPI.barcode("0012345678905"))
        XCTAssertEqual(found.food?.name, "Banana")
        let missing = try await api.send(FoodAPI.barcode("0099999999999"))
        XCTAssertNil(missing.food)
        XCTAssertEqual(missing.code, "0099999999999")
        let recent = try await api.send(FoodAPI.recent(meal: .breakfast))
        XCTAssertEqual(sent().request.url?.query(), "meal=breakfast")
        XCTAssertEqual(recent.foods.count, 1)
        _ = try await api.send(FoodAPI.frequent(meal: nil))
        XCTAssertNil(sent().request.url?.query())
    }

    func testLogSendsExactlyTheLogFields() async throws {
        HTTPStub.routes(["/api/log": .json(200, #"{"entry":{"id":20,"day":"2026-11-18","meal":"lunch","name":"Banana","brand":null,"icon":"🍌","servingIndex":0,"unit":"serving","quantity":1.5,"fraction":0.5,"servings":[{"label":"1 medium","grams":118}],"nutrients":{"calories":78.75},"aiEstimated":false,"source":"cache"}}"#)])
        let banana = try JSONDecoder().decode(Food.self, from: Data(FoodFixtures.banana.utf8))
        let r = try await api.send(FoodAPI.log(food: banana, day: "2026-11-18", meal: .lunch, servingIndex: 0, quantity: 1.5))
        XCTAssertEqual(r.entry.id, 20)
        let body = try XCTUnwrap(sent().json)
        XCTAssertEqual(body.keys.sorted(), ["day", "food", "fraction", "meal", "quantity", "servingIndex", "unit"])
        XCTAssertEqual(body["unit"] as? String, "serving")
        XCTAssertEqual(body["meal"] as? String, "lunch")
        XCTAssertEqual((body["food"] as? [String: Any])?["kind"] as? String, "cache")
        XCTAssertEqual((body["food"] as? [String: Any])?["id"] as? Int, 41)
    }

    func testEstimateItemsAndLogEstimates() async throws {
        HTTPStub.routes([
            "/api/ai/estimate-items": .json(200, #"{"items":[\#(FoodFixtures.egg),\#(FoodFixtures.toast)],"assumed":true,"interpretedAs":"eggs and toast"}"#),
            "/api/log/estimates": .json(200, #"{"entries":[]}"#),
        ])
        let r = try await api.send(FoodAPI.estimateItems("2 eggs n toast"))
        XCTAssertEqual(sent().json?["text"] as? String, "2 eggs n toast")
        XCTAssertEqual(r.items.map(\.food.name), ["Egg, large", "Toast"])
        XCTAssertEqual(r.items[0].quantity, 2)
        XCTAssertEqual(r.interpretedAs, "eggs and toast")

        _ = try await api.send(FoodAPI.logEstimates(r.items, day: "2026-11-19", meal: .breakfast))
        let body = try XCTUnwrap(sent().json)
        XCTAssertEqual(body["day"] as? String, "2026-11-19")
        XCTAssertEqual(body["meal"] as? String, "breakfast")
        let items = try XCTUnwrap(body["items"] as? [[String: Any]])
        XCTAssertEqual(items.count, 2)
        XCTAssertEqual(items[0]["name"] as? String, "Egg, large")
        XCTAssertEqual(items[0]["quantity"] as? Double, 2)
        XCTAssertEqual(items[0]["servingIndex"] as? Int, 0)
        XCTAssertEqual((items[0]["nutrients"] as? [String: Any])?["calories"] as? Double, 72)
        XCTAssertNotNil(items[0]["servings"] as? [[String: Any]])
    }

    func testPhotoUploadIsMultipart() async throws {
        HTTPStub.routes(["/api/photos/analyze": .json(200, #"{"photoIds":["p1"],"plate":{"items":[\#(FoodFixtures.egg)]},"errors":[],"labelReading":true}"#)])
        let jpeg = Data([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3])
        let r = try await api.send(FoodAPI.analyzePhoto(jpeg: jpeg, mode: .plate))
        XCTAssertEqual(r.plate?.items.first?.food.name, "Egg, large")
        XCTAssertTrue(r.labelReading)

        let type = try XCTUnwrap(sent().request.value(forHTTPHeaderField: "Content-Type"))
        XCTAssertTrue(type.hasPrefix("multipart/form-data; boundary="))
        let boundary = String(type.dropFirst("multipart/form-data; boundary=".count))
        let body = try XCTUnwrap(sent().body)
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertTrue(text.contains("--\(boundary)\r\nContent-Disposition: form-data; name=\"mode\"\r\n\r\nplate\r\n"))
        XCTAssertTrue(text.contains("Content-Disposition: form-data; name=\"images\"; filename=\"photo.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n"))
        XCTAssertTrue(text.hasSuffix("--\(boundary)--\r\n"))
        XCTAssertNotNil(body.range(of: jpeg), "the photo's bytes are sent as they are")
    }

    func testPhotoResultWithADraftOrAFood() async throws {
        HTTPStub.routes(["/api/photos/analyze": .json(200, #"{"photoIds":["p1"],"draft":\#(FoodFixtures.draft),"errors":[],"labelReading":true}"#)])
        let label = try await api.send(FoodAPI.analyzePhoto(jpeg: Data([1]), mode: .label))
        XCTAssertEqual(label.draft?.name, "Wheat crackers")
        XCTAssertEqual(label.draft?.photoId, "p1")
        XCTAssertNil(label.food)

        HTTPStub.routes(["/api/photos/analyze": .json(200, #"{"photoIds":["p2"],"barcode":"0012345678905","food":\#(FoodFixtures.banana),"errors":[],"labelReading":false}"#)])
        let code = try await api.send(FoodAPI.analyzePhoto(jpeg: Data([1]), mode: .auto))
        XCTAssertEqual(code.barcode, "0012345678905")
        XCTAssertEqual(code.food?.name, "Banana")
    }

    func testSaveFoodBindsTheBarcodeAndMarksEveryNutrientRead() async throws {
        HTTPStub.routes(["/api/my-foods": .json(200, #"{"food":{"kind":"user_food","id":9,"name":"Wheat crackers","brand":"Acme","icon":"🍘","barcode":"0099999999999","servings":[{"label":"2 crackers","grams":30}],"nutrients":{"calories":140},"aiFields":["calories"],"imageUrl":null,"override":false,"source":"mine","foodKind":"custom"}}"#)])
        let draft = try JSONDecoder().decode(AiDraft.self, from: Data(FoodFixtures.draft.utf8))
        let r = try await api.send(FoodAPI.saveFood(draft, barcode: "0099999999999"))
        XCTAssertEqual(r.food.ref, "user_food:9")
        let body = try XCTUnwrap(sent().json)
        XCTAssertEqual(sent().request.httpMethod, "POST")
        XCTAssertEqual(body["barcode"] as? String, "0099999999999")
        XCTAssertEqual(body["aiFields"] as? [String], ["calories", "fat_g", "protein_g"])
        XCTAssertEqual(body["photoId"] as? String, "p1")
        XCTAssertEqual(body["name"] as? String, "Wheat crackers")
        XCTAssertEqual(body["brand"] as? String, "Acme")
    }

    func testAISlowCallsWaitLongerThanUsual() {
        XCTAssertGreaterThanOrEqual(FoodAPI.analyzePhoto(jpeg: Data(), mode: .plate).timeout, 90)
        XCTAssertGreaterThanOrEqual(FoodAPI.estimateItems("x").timeout, 90)
        XCTAssertEqual(FoodAPI.search("x").timeout, 20)
    }

    func testFoodsCanBeUsedAsNavigationValues() throws {
        let banana = try JSONDecoder().decode(Food.self, from: Data(FoodFixtures.banana.utf8))
        XCTAssertEqual(Set([banana, banana]).count, 1) // Hashable: Track Food pushes the portion screen with it
    }

    func testACancelledCallIsACancellationNotAnOutage() async {
        HTTPStub.routes(["/api/foods/search": .delayed(2, .json(200, FoodFixtures.search))])
        let api = self.api
        let call = Task { try await api.send(FoodAPI.search("banana")) }
        try? await Task.sleep(for: .milliseconds(100))
        call.cancel()
        do {
            _ = try await call.value
            XCTFail("should have stopped")
        } catch {
            XCTAssertTrue(error is CancellationError, "\(error)")
        }
    }

    func testValuesThePersonCorrectedAreNotMarkedAI() async throws {
        HTTPStub.routes(["/api/my-foods": .json(200, #"{"food":\#(FoodFixtures.banana)}"#)])
        let read = try JSONDecoder().decode(AiDraft.self, from: Data(FoodFixtures.draft.utf8)) // calories 140, protein 3, fat 5
        var fixed = read
        fixed.nutrients = Nutrients(["calories": 150, "protein_g": 3, "fat_g": 5, "fiber_g": 2])
        _ = try await api.send(FoodAPI.saveFood(fixed, barcode: nil, original: read))
        XCTAssertEqual(sent().json?["aiFields"] as? [String], ["fat_g", "protein_g"]) // calories corrected, fiber typed in
    }

    func testASlowAIAnswerSaysSo() async {
        HTTPStub.routes(["/api/ai/estimate-items": .fail(.timedOut), "/api/foods/search": .fail(.timedOut)])
        do {
            _ = try await api.send(FoodAPI.estimateItems("a sandwich"))
            XCTFail("should fail")
        } catch {
            XCTAssertEqual((error as? APIError)?.message, "The AI took too long — try again")
        }
        do {
            _ = try await api.send(FoodAPI.search("bread"))
            XCTFail("should fail")
        } catch {
            XCTAssertEqual((error as? APIError)?.message, "Can't reach ByteSize at h.test", "an ordinary call that times out is still unreachable")
        }
    }
}
