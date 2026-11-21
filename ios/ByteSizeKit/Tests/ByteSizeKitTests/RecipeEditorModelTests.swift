import XCTest
@testable import ByteSizeKit

@MainActor
final class RecipeEditorModelTests: XCTestCase {
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)

    private static func recipe(_ items: [String], name: String = "Chili", servings: Double = 4, grams: String = "350", notes: String = #""Freezes well""#) -> String {
        let base = MyFoodFixtures.food(30, name, kind: "recipe", calories: 400).dropLast()
        return #"{"food":\#(base),"notes":\#(notes),"items":[\#(items.joined(separator: ","))],"recipeServings":\#(servings),"servingGrams":\#(grams)}}"#
    }
    private nonisolated static let two = [MyFoodFixtures.item(5, "Beans", calories: 200, quantity: 2), MyFoodFixtures.item(6, "Beef", calories: 400)]

    private func serve(save: HTTPStub.Reply? = nil, recalculated: [String]? = nil) {
        let detail = Self.recipe(Self.two)
        let saved = #"{"food":\#(MyFoodFixtures.food(30, "Chili", kind: "recipe"))}"#
        let fresh = Self.recipe(recalculated ?? Self.two)
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            switch (req.httpMethod ?? "", req.url?.path() ?? "") {
            case ("GET", "/api/my-foods/30"): return .json(200, detail)
            case ("POST", "/api/my-foods/recipes"), ("PUT", "/api/my-foods/recipes/30"): return save ?? .json(200, saved)
            case ("POST", "/api/my-foods/30/recalculate"): return .json(200, fresh)
            default: return .json(404, #"{"error":"Not found"}"#)
            }
        }
    }

    private func item(_ id: Int, _ name: String, calories: Double) -> EditItem {
        EditItem(try! JSONDecoder().decode(MealItem.self, from: Data(MyFoodFixtures.item(id, name, calories: calories).utf8)))
    }

    func testLoadFillsTheForm() async {
        serve()
        let m = RecipeEditorModel(api: api, id: 30)
        await m.load()
        XCTAssertEqual(m.name, "Chili")
        XCTAssertEqual(m.servings, "4")
        XCTAssertEqual(m.weight, "350")
        XCTAssertEqual(m.notes, "Freezes well")
        XCTAssertEqual(m.items.map(\.name), ["Beans", "Beef"])
        XCTAssertEqual(m.perServing["calories"], 200, "(400 + 400) / 4")
        XCTAssertFalse(m.changed)
        XCTAssertTrue(m.loaded)
    }

    func testSaveNewPosts() async throws {
        serve()
        let m = RecipeEditorModel(api: api, id: nil)
        XCTAssertTrue(m.loaded)
        XCTAssertEqual(m.servings, "1")
        m.name = "Soup"
        m.add(item(5, "Beans", calories: 200))
        let out = await m.save()
        XCTAssertNotNil(out)
        let body = try XCTUnwrap(HTTPStub.requests.last { $0.request.httpMethod == "POST" }?.json)
        XCTAssertEqual(body["name"] as? String, "Soup")
        XCTAssertEqual(body["servings"] as? Double, 1)
        XCTAssertTrue(body["servingGrams"] is NSNull)
        XCTAssertTrue(body["notes"] is NSNull)
        XCTAssertEqual((body["items"] as? [Any])?.count, 1)
    }

    func testSaveExistingPuts() async throws {
        serve()
        let m = RecipeEditorModel(api: api, id: 30)
        await m.load()
        m.remove(at: 0)
        XCTAssertTrue(m.changed)
        _ = await m.save()
        let req = try XCTUnwrap(HTTPStub.requests.last)
        XCTAssertEqual(req.request.httpMethod, "PUT")
        XCTAssertEqual(req.request.url?.path(), "/api/my-foods/recipes/30")
        XCTAssertEqual((req.json?["items"] as? [Any])?.count, 1)
        XCTAssertEqual(req.json?["servingGrams"] as? Double, 350)
        XCTAssertEqual(req.json?["notes"] as? String, "Freezes well")
    }

    func testValidationMessages() async {
        serve()
        let m = RecipeEditorModel(api: api, id: nil)
        _ = await m.save()
        XCTAssertEqual(m.message, "Give the recipe a name")
        m.name = "Soup"
        _ = await m.save()
        XCTAssertEqual(m.message, "Add at least one ingredient")
        m.add(item(5, "Beans", calories: 200))
        m.servings = "0"
        _ = await m.save()
        XCTAssertEqual(m.message, "The number of servings must be more than 0")
        m.servings = "2"
        m.weight = "-5"
        _ = await m.save()
        XCTAssertEqual(m.message, "The weight of one serving must be more than 0 g")
        XCTAssertTrue(HTTPStub.requests.isEmpty)
    }

    func testRecalculateWaitsForSave() async {
        serve()
        let fresh = RecipeEditorModel(api: api, id: nil)
        XCTAssertFalse(fresh.canRecalculate, "not saved yet")
        let m = RecipeEditorModel(api: api, id: 30)
        await m.load()
        XCTAssertTrue(m.canRecalculate)
        m.notes = "Spicy"
        XCTAssertFalse(m.canRecalculate, "Save your changes first")
    }

    func testRecalculateReplacesItems() async {
        serve(recalculated: [MyFoodFixtures.item(5, "Beans", calories: 250, quantity: 2), MyFoodFixtures.item(6, "Beef", calories: 400)])
        let m = RecipeEditorModel(api: api, id: 30)
        await m.load()
        await m.recalculate()
        XCTAssertEqual(m.notice, "Recalculated")
        XCTAssertEqual(m.perServing["calories"], 225, "(500 + 400) / 4")
        XCTAssertFalse(m.changed, "recalculated is as saved")
    }

    func testIngredientsExcludeQuickMealsAndItself() throws {
        let m = RecipeEditorModel(api: api, id: 30)
        let decode = { (json: String) in try JSONDecoder().decode(Food.self, from: Data(json.utf8)) }
        XCTAssertFalse(m.allows(try decode(MyFoodFixtures.food(90, "Usual breakfast", kind: "quick_meal"))))
        XCTAssertFalse(m.allows(try decode(MyFoodFixtures.food(30, "Chili", kind: "recipe"))), "not itself")
        XCTAssertTrue(m.allows(try decode(MyFoodFixtures.food(31, "Cornbread", kind: "recipe"))))
    }

    /// Review I-1: a recipe that didn't load must not become an empty form that saves over the real one.
    func testFailedLoadIsNotEditable() async {
        HTTPStub.requests = []
        HTTPStub.handler = { _ in .json(500, #"{"error":"Something went wrong"}"#) }
        let m = RecipeEditorModel(api: api, id: 30)
        await m.load()
        XCTAssertFalse(m.loaded)
        XCTAssertEqual(m.message, "Something went wrong")
        m.name = "Oops"
        let out = await m.save()
        XCTAssertNil(out)
        XCTAssertFalse(HTTPStub.requests.contains { $0.request.httpMethod == "PUT" }, "nothing saved over the real recipe")
    }

    func testServerErrorStays() async {
        serve(save: .json(400, #"{"error":"That's too many ingredients"}"#))
        let m = RecipeEditorModel(api: api, id: 30)
        await m.load()
        let out = await m.save()
        XCTAssertNil(out)
        XCTAssertEqual(m.message, "That's too many ingredients")
    }
}

@MainActor
final class QuickMealEditorModelTests: XCTestCase {
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)

    private func serve() {
        let detail = MyFoodFixtures.meal(MyFoodFixtures.item(5, "Eggs", calories: 72, quantity: 2), MyFoodFixtures.item(6, "Toast", calories: 80))
        let saved = #"{"food":\#(MyFoodFixtures.food(90, "Usual breakfast", kind: "quick_meal"))}"#
        HTTPStub.requests = []
        HTTPStub.handler = { req in
            switch (req.httpMethod ?? "", req.url?.path() ?? "") {
            case ("GET", "/api/my-foods/90"): return .json(200, detail)
            case ("POST", "/api/my-foods/meals"), ("PUT", "/api/my-foods/meals/90"): return .json(200, saved)
            default: return .json(404, #"{"error":"Not found"}"#)
            }
        }
    }

    func testLoadAndTotal() async {
        serve()
        let m = QuickMealEditorModel(api: api, id: 90)
        await m.load()
        XCTAssertEqual(m.name, "Usual breakfast")
        XCTAssertEqual(m.items.map(\.name), ["Eggs", "Toast"])
        XCTAssertEqual(m.total["calories"], 224)
    }

    func testSaveNewPosts() async throws {
        serve()
        let m = QuickMealEditorModel(api: api, id: nil)
        m.name = "Snack plate"
        m.add(EditItem(try JSONDecoder().decode(MealItem.self, from: Data(MyFoodFixtures.item(6, "Toast", calories: 80).utf8))))
        _ = await m.save()
        let req = try XCTUnwrap(HTTPStub.requests.last)
        XCTAssertEqual(req.request.httpMethod, "POST")
        XCTAssertEqual(req.request.url?.path(), "/api/my-foods/meals")
        XCTAssertEqual(req.json?["name"] as? String, "Snack plate")
    }

    func testSaveExistingPuts() async throws {
        serve()
        let m = QuickMealEditorModel(api: api, id: 90)
        await m.load()
        m.remove(at: 1)
        _ = await m.save()
        let req = try XCTUnwrap(HTTPStub.requests.last)
        XCTAssertEqual(req.request.httpMethod, "PUT")
        XCTAssertEqual((req.json?["items"] as? [Any])?.count, 1)
    }

    func testValidationMessages() async {
        serve()
        let m = QuickMealEditorModel(api: api, id: nil)
        _ = await m.save()
        XCTAssertEqual(m.message, "Give the meal a name")
        m.name = "Snack"
        _ = await m.save()
        XCTAssertEqual(m.message, "Add at least one food")
        XCTAssertTrue(HTTPStub.requests.isEmpty)
    }

    func testFailedLoadIsNotEditable() async {
        HTTPStub.requests = []
        HTTPStub.handler = { _ in .json(500, #"{"error":"Something went wrong"}"#) }
        let m = QuickMealEditorModel(api: api, id: 90)
        await m.load()
        XCTAssertFalse(m.loaded)
        m.name = "Oops"
        _ = await m.save()
        XCTAssertFalse(HTTPStub.requests.contains { $0.request.httpMethod == "PUT" })
    }

    func testItemsExcludeQuickMeals() throws {
        let m = QuickMealEditorModel(api: api, id: nil)
        XCTAssertFalse(m.allows(try JSONDecoder().decode(Food.self, from: Data(MyFoodFixtures.food(90, "Usual breakfast", kind: "quick_meal").utf8))))
        XCTAssertTrue(m.allows(try JSONDecoder().decode(Food.self, from: Data(MyFoodFixtures.food(30, "Chili", kind: "recipe").utf8))))
    }
}
