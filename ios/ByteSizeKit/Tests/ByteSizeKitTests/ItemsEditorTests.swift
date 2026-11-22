import XCTest
@testable import ByteSizeKit

@MainActor
final class ItemsEditorTests: XCTestCase {
    private let api = APIClient(base: ServerAddress("https://h.test")!, token: { "t" }, session: HTTPStub.session)

    private func mealItem(_ json: String) -> MealItem { try! JSONDecoder().decode(MealItem.self, from: Data(json.utf8)) }

    private func food(_ id: Int, _ name: String, kind: String = "cache", foodKind: String = "custom") -> String {
        #"{"kind":"\#(kind)","id":\#(id),"name":"\#(name)","brand":null,"icon":"🍌","barcode":null,"servings":[{"label":"1 medium","grams":118},{"label":"100 g","grams":100}],"nutrients":{"calories":105,"protein_g":1.3},"aiFields":[],"source":"usda","foodKind":"\#(foodKind)"}"#
    }

    func testItemFromAMealItemKeepsItsPortion() {
        let item = EditItem(mealItem(MyFoodFixtures.item(5, "Eggs", calories: 72, quantity: 2)))
        XCTAssertEqual(item.name, "Eggs")
        XCTAssertEqual(item.quantity, 2)
        XCTAssertEqual(item.body, MealItemBody(food: FoodRef(kind: "cache", id: 5), servingIndex: 0, unit: "serving", quantity: 2, fraction: 1))
        XCTAssertEqual(item.nutrients["calories"], 144)
    }

    func testItemFromAPickedFoodAndPortion() throws {
        let banana = try JSONDecoder().decode(Food.self, from: Data(food(41, "Banana").utf8))
        let portion = PortionModel(food: banana, meal: .snacks)
        portion.choice = .serving(1)
        portion.whole = 2
        let item = EditItem(food: banana, portion: portion)
        XCTAssertEqual(item.body, MealItemBody(food: FoodRef(kind: "cache", id: 41), servingIndex: 1, unit: "serving", quantity: 2, fraction: 1))
        XCTAssertEqual(item.nutrients["calories"], 105 * 200 / 118, accuracy: 0.01, "2 × 100 g of a food per 118 g")
    }

    func testItemNutrientsFollowTheAmount() {
        var item = EditItem(mealItem(MyFoodFixtures.item(5, "Eggs", calories: 72, quantity: 2)))
        item.setPortion(servingIndex: 0, unit: "serving", quantity: 3)
        XCTAssertEqual(item.nutrients["calories"], 216)
        XCTAssertEqual(item.fraction, 1)
    }

    func testSumTreatsMissingAsZero() {
        let a = EditItem(mealItem(MyFoodFixtures.item(5, "Eggs", calories: 72, quantity: 2)))
        let b = EditItem(mealItem(MyFoodFixtures.item(6, "Toast", calories: 80)))
        let total = EditItem.sum([a, b])
        XCTAssertEqual(total["calories"], 224)
        XCTAssertEqual(total["protein_g"], 0)
        XCTAssertEqual(total.divided(by: 2)["calories"], 112)
        XCTAssertEqual(total.divided(by: 0).values, [:])
    }

    func testUnavailableItemKeepsItsAmount() {
        let item = EditItem(mealItem(MyFoodFixtures.item(5, "Old jam", calories: 50, quantity: 3, available: false)))
        XCTAssertFalse(item.available)
        XCTAssertEqual(item.body.quantity, 3)
    }

    func testPickerKeepsOnlyAllowedFoods() async throws {
        let groups = #"{"groups":[{"source":"mine","label":"My foods","foods":[\#(food(1, "Chili", kind: "user_food", foodKind: "recipe")),\#(food(2, "Usual breakfast", kind: "user_food", foodKind: "quick_meal"))]},{"source":"usda","label":"USDA","foods":[\#(food(41, "Banana"))]},{"source":"culury","label":"RecipeHub","foods":[\#(food(9, "Banana bread", kind: "culury"))]}],"errors":[]}"#
        HTTPStub.requests = []
        HTTPStub.handler = { req in req.url?.path() == "/api/foods/search" ? .json(200, groups) : .json(404, #"{"error":"Not found"}"#) }
        let picker = FoodPickerModel(api: api) { $0.foodKind != "quick_meal" }
        picker.query = "ba"
        await picker.search()
        XCTAssertEqual(picker.results.map(\.name), ["Chili", "Banana"], "no quick meals, no RecipeHub recipes")
    }

    /// Review I-3: going back under two letters clears an old error and the spinner.
    func testShortQueryClearsTheMessage() async {
        HTTPStub.requests = []
        HTTPStub.handler = { _ in .json(500, #"{"error":"Search is down"}"#) }
        let picker = FoodPickerModel(api: api) { _ in true }
        picker.query = "ban"
        await picker.search()
        XCTAssertEqual(picker.message, "Search is down")
        picker.query = "b"
        await picker.search()
        XCTAssertNil(picker.message)
        XCTAssertFalse(picker.searching)
    }

    func testPickerNeedsTwoLetters() async {
        HTTPStub.requests = []
        HTTPStub.handler = { _ in .json(200, #"{"groups":[],"errors":[]}"#) }
        let picker = FoodPickerModel(api: api) { _ in true }
        picker.query = "b"
        await picker.search()
        XCTAssertEqual(picker.results, [])
        XCTAssertTrue(HTTPStub.requests.isEmpty)
    }
}
