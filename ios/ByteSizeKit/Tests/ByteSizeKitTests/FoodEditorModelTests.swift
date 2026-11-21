import XCTest
@testable import ByteSizeKit

@MainActor
final class FoodEditorModelTests: XCTestCase {
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)
    private nonisolated static let saved = #"{"food":\#(MyFoodFixtures.food(7, "Granola"))}"#

    private func serve(save: HTTPStub.Reply = .json(200, FoodEditorModelTests.saved), fill: HTTPStub.Reply = .json(200, #"{"nutrients":{"protein_g":4,"fat_g":6,"calories":999},"aiFields":["protein_g","fat_g","calories"]}"#)) {
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            switch (req.httpMethod ?? "", req.url?.path() ?? "") {
            case ("POST", "/api/my-foods"), ("PATCH", "/api/my-foods/7"), ("PATCH", "/api/my-foods/8"): return save
            case ("POST", "/api/ai/fill-gaps"): return fill
            default: return .json(404, #"{"error":"Not found"}"#)
            }
        }
    }

    private func sent(_ method: String) -> [String: Any]? {
        HTTPStub.requests.last { $0.request.httpMethod == method }?.json
    }

    private func food(_ id: Int = 7, kind: String = "custom", ai: [String] = []) -> Food {
        let json = #"{"kind":"user_food","id":\#(id),"name":"Oat bars","brand":"Acme","icon":"🍪","barcode":"0012345678905","servings":[{"label":"1 bar","grams":40},{"label":"1 box","grams":240,"ml":300,"approx":true}],"nutrients":{"calories":190,"protein_g":3},"aiFields":\#(ai),"source":"mine","foodKind":"\#(kind)"}"#
        return try! JSONDecoder().decode(Food.self, from: Data(json.utf8))
    }

    func testNewFoodPosts() async throws {
        serve()
        let m = FoodEditorModel(api: api, food: nil)
        XCTAssertEqual(m.servings.map(\.label), ["1 serving"])
        m.name = " Granola "
        m.servings[0].label = "1 cup"
        m.servings[0].grams = "60"
        m.setValue("calories", "200")
        let out = await m.save()
        XCTAssertEqual(out?.name, "Granola")
        let body = try XCTUnwrap(sent("POST"))
        XCTAssertEqual(body["name"] as? String, "Granola")
        XCTAssertTrue(body["brand"] is NSNull)
        XCTAssertEqual((body["servings"] as? [[String: Any]])?.first?["label"] as? String, "1 cup")
        XCTAssertEqual((body["servings"] as? [[String: Any]])?.first?["grams"] as? Double, 60)
        XCTAssertEqual((body["nutrients"] as? [String: Double]), ["calories": 200])
    }

    func testEditingPatches() async throws {
        serve()
        let m = FoodEditorModel(api: api, food: food())
        XCTAssertEqual(m.name, "Oat bars")
        XCTAssertEqual(m.brand, "Acme")
        XCTAssertEqual(m.barcode, "0012345678905")
        XCTAssertEqual(m.servings.map(\.label), ["1 bar", "1 box"])
        XCTAssertEqual(m.servings[1].ml, "", "an estimated volume isn't shown as a measured one")
        XCTAssertEqual(m.values["calories"], "190")
        XCTAssertEqual(m.values["fat_g"], "")
        m.name = "Oat bars (big)"
        _ = await m.save()
        XCTAssertNil(sent("POST"))
        let body = try XCTUnwrap(sent("PATCH"))
        XCTAssertEqual(body["name"] as? String, "Oat bars (big)")
        XCTAssertEqual(body["barcode"] as? String, "0012345678905")
    }

    func testEditingAnOverridePatches() async {
        serve()
        let m = FoodEditorModel(api: api, food: food(8, kind: "override"))
        _ = await m.save()
        XCTAssertEqual(HTTPStub.requests.last?.request.url?.path(), "/api/my-foods/8")
        XCTAssertEqual(HTTPStub.requests.last?.request.httpMethod, "PATCH")
    }

    func testNameAndServingRequired() async {
        serve()
        let m = FoodEditorModel(api: api, food: nil)
        m.name = "  "
        var out = await m.save()
        XCTAssertNil(out)
        XCTAssertEqual(m.message, "Give the food a name")
        m.name = "Granola"
        m.servings[0].label = " "
        out = await m.save()
        XCTAssertNil(out)
        XCTAssertEqual(m.message, "Name the serving size, like “1 cup”")
        XCTAssertTrue(HTTPStub.requests.isEmpty)
    }

    func testBlankNutrientsAndServingsAreNotSent() async throws {
        serve()
        let m = FoodEditorModel(api: api, food: food())
        m.setValue("protein_g", "")
        m.addServing()
        XCTAssertEqual(m.servings.count, 3)
        _ = await m.save()
        let body = try XCTUnwrap(sent("PATCH"))
        XCTAssertEqual((body["nutrients"] as? [String: Double]), ["calories": 190])
        XCTAssertEqual((body["servings"] as? [Any])?.count, 2, "an empty extra serving row is dropped")
        m.removeServing(at: 0)
        XCTAssertEqual(m.servings.count, 3, "the first serving stays")
        m.removeServing(at: 2)
        XCTAssertEqual(m.servings.count, 2)
    }

    func testEditingClearsTheAIMark() {
        serve()
        let m = FoodEditorModel(api: api, food: food(ai: ["calories", "protein_g"]))
        XCTAssertEqual(m.aiFields, ["calories", "protein_g"])
        m.setValue("calories", "180")
        XCTAssertEqual(m.aiFields, ["protein_g"])
    }

    func testFillGapsFillsOnlyBlanks() async throws {
        serve()
        let m = FoodEditorModel(api: api, food: food())
        XCTAssertTrue(m.canFillGaps)
        await m.fillGaps()
        XCTAssertEqual(m.values["protein_g"], "3", "a value already there stays")
        XCTAssertEqual(m.values["fat_g"], "6")
        XCTAssertEqual(m.values["calories"], "190")
        XCTAssertEqual(m.aiFields, ["fat_g"])
        let body = try XCTUnwrap(sent("POST"))
        XCTAssertEqual((body["food"] as? [String: Any])?["kind"] as? String, "user_food")
        XCTAssertEqual((body["food"] as? [String: Any])?["id"] as? Int, 7)
        XCTAssertFalse(FoodEditorModel(api: api, food: nil).canFillGaps, "a new food can't ask yet")
    }

    func testServerErrorStaysOnTheForm() async {
        serve(save: .json(400, #"{"error":"Add at least one serving"}"#))
        let m = FoodEditorModel(api: api, food: food())
        let out = await m.save()
        XCTAssertNil(out)
        XCTAssertEqual(m.message, "Add at least one serving")
        XCTAssertFalse(m.busy)
    }

    func testNutrientKeysInTheWebsitesOrder() {
        XCTAssertEqual(Nutrients.keys.count, 13)
        XCTAssertEqual(Nutrients.keys.first?.label, "Calories")
        XCTAssertEqual(Nutrients.keys.last?.key, "water_ml")
    }
}
