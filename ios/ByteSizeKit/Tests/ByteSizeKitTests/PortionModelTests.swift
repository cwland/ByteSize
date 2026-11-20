import XCTest
@testable import ByteSizeKit

@MainActor
final class PortionModelTests: XCTestCase {
    private func portion(calories: Double = 100, servings: [Serving] = [Serving(label: "1 bar", grams: 40)]) -> PortionModel {
        PortionModel(name: "Bar", icon: "🍫", servings: servings, nutrients: Nutrients(["calories": calories]), meal: .lunch)
    }

    func testDefaults() {
        let p = portion()
        XCTAssertEqual(p.servingIndex, 0)
        XCTAssertEqual(p.quantityText, "1")
        XCTAssertEqual(p.fraction, 1)
        XCTAssertEqual(p.meal, .lunch)
        XCTAssertEqual(p.quantity, 1)
        XCTAssertTrue(p.canLog)
        XCTAssertEqual(p.previewCalories, 100)
        XCTAssertEqual(PortionModel.fractions, [0.25, 1.0 / 3, 0.5, 0.75, 1])
    }

    func testTypedAmounts() {
        let p = portion()
        p.quantityText = "1.5"
        XCTAssertEqual(p.quantity, 1.5)
        p.quantityText = "2,5" // a comma decimal, as some keyboards type it
        XCTAssertEqual(p.quantity, 2.5)
        p.quantityText = " 3 "
        XCTAssertEqual(p.quantity, 3)
        for bad in ["0", "", "abc", "-1", "1.2.3"] {
            p.quantityText = bad
            XCTAssertNil(p.quantity, bad)
            XCTAssertFalse(p.canLog, bad)
            XCTAssertNil(p.previewCalories, bad)
        }
    }

    func testPreviewIsPerServingTimesTheAmount() {
        let p = portion()
        p.quantityText = "2"
        p.fraction = 0.5
        XCTAssertEqual(p.previewCalories, 100)
        p.fraction = 0.25
        p.quantityText = "1"
        XCTAssertEqual(p.previewCalories, 25)
    }

    func testAnotherServingScalesByWeight() {
        let p = portion(calories: 240, servings: [Serving(label: "1 cup", grams: 240), Serving(label: "1 tbsp", grams: 15)])
        p.servingIndex = 1
        XCTAssertEqual(p.previewCalories, 15)
        p.quantityText = "4"
        XCTAssertEqual(p.previewCalories, 60)
    }

    func testAnotherServingByVolumeOrUnknownSize() {
        let drink = portion(calories: 120, servings: [Serving(label: "1 can", ml: 355), Serving(label: "100 ml", ml: 100)])
        drink.servingIndex = 1
        XCTAssertEqual(drink.previewCalories, 34) // 120 × 100/355 = 33.8
        let loose = portion(calories: 100, servings: [Serving(label: "1 piece"), Serving(label: "1 handful")])
        loose.servingIndex = 1
        XCTAssertEqual(loose.previewCalories, 100) // no sizes to compare: a preview only, the server decides
    }

    func testFromAFoodStartsAtItsFirstServing() throws {
        let food = try JSONDecoder().decode(Food.self, from: Data(FoodFixtures.banana.utf8))
        let p = PortionModel(food: food, meal: .snacks)
        XCTAssertEqual(p.name, "Banana")
        XCTAssertEqual(p.servings.count, 2)
        XCTAssertEqual(p.previewCalories, 105)
        p.servingIndex = 1
        XCTAssertEqual(p.previewCalories, 89) // 105 × 100/118
    }
}
