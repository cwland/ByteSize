import XCTest
@testable import ByteSizeKit

/// L1: a portion is whole + fraction of any unit the food offers (its servings — including ones the server worked
/// out, like "1 prune" — then g/oz when it has a weight, then volumes when it has a volume).
@MainActor
final class PortionModelTests: XCTestCase {
    private let prunes = [Serving(label: "5 prunes", grams: 40), Serving(label: "1 prune", grams: 8, derived: true)]

    private func portion(_ servings: [Serving], calories: Double = 150) -> PortionModel {
        PortionModel(name: "Prunes", icon: "🍇", servings: servings, nutrients: Nutrients(["calories": calories]), meal: .snacks)
    }

    func testStartsAtOneOfTheFoodsServing() {
        let p = portion(prunes)
        XCTAssertEqual(p.whole, 1)
        XCTAssertEqual(p.fraction, 0)
        XCTAssertEqual(p.choice, .serving(0))
        XCTAssertEqual(p.quantity, 1)
        XCTAssertTrue(p.canLog)
        XCTAssertEqual(p.previewCalories, 150)
    }

    func testSixPrunesFromAFivePruneFood() {
        let p = portion(prunes)
        p.choice = .serving(1)
        p.whole = 6
        XCTAssertEqual(p.servingIndex, 1)
        XCTAssertEqual(p.unit, .serving)
        XCTAssertEqual(p.previewCalories, 180)
    }

    func testTheUnitsOnOffer() {
        XCTAssertEqual(portion(prunes).choices.map(\.label), ["5 prunes", "1 prune", "g", "oz"])
        let drink = portion([Serving(label: "1 can", ml: 355)])
        XCTAssertEqual(drink.choices.map(\.label), ["1 can", "ml", "fl oz", "cup", "tbsp", "tsp"])
        let loose = portion([Serving(label: "1 bowl")])
        XCTAssertEqual(loose.choices.map(\.label), ["1 bowl"])
    }

    func testSwitchingUnitKeepsTheNumber() {
        let p = portion([Serving(label: "1 cup", grams: 240, ml: 240)], calories: 240)
        p.choice = .unit(.cup)
        p.whole = 3
        p.choice = .unit(.tbsp)
        XCTAssertEqual(p.whole, 3)
        XCTAssertEqual(p.unit, .tbsp)
        XCTAssertEqual(p.previewCalories, 44) // 3 tbsp = 44.36 ml of a 240 ml cup
    }

    func testGramsAndFractions() {
        let p = portion(prunes)
        p.choice = .unit(.g)
        p.whole = 100
        XCTAssertEqual(p.previewCalories, 375)
        XCTAssertTrue(p.wholeRange.contains(100))
        XCTAssertTrue(p.wholeRange.contains(1000))
        p.choice = .serving(0)
        p.whole = 2
        p.fraction = 0.5
        XCTAssertEqual(p.quantity, 2.5)
        XCTAssertFalse(p.wholeRange.contains(1000), "big steps only for g and ml")
    }

    func testNothingCantBeLogged() {
        let p = portion(prunes)
        p.whole = 0
        p.fraction = 0
        XCTAssertFalse(p.canLog)
        XCTAssertNil(p.previewCalories)
    }

    func testBigAmounts() {
        let p = portion([Serving(label: "1 medium", grams: 118)], calories: 105)
        p.whole = 21
        XCTAssertTrue(p.isBig)
        XCTAssertEqual(p.previewCalories, 2205)
        p.whole = 3
        XCTAssertFalse(p.isBig)
    }

    func testFromAFood() throws {
        let food = try JSONDecoder().decode(Food.self, from: Data(FoodFixtures.banana.utf8))
        let p = PortionModel(food: food, meal: .lunch)
        XCTAssertEqual(p.name, "Banana")
        XCTAssertEqual(p.meal, .lunch)
        XCTAssertEqual(p.previewCalories, 105)
    }

    func testAnEntryLoggedBeforeKeepsItsServingAndAmount() throws {
        // logged in I2/I3: 1.5 × "1 tbsp" at ½ (0.75 tbsp), 30 cal for that amount
        let json = #"{"id":5,"day":"2026-11-18","meal":"breakfast","name":"Peanut butter","brand":null,"icon":"🥜","servingIndex":1,"unit":"serving","quantity":1.5,"fraction":0.5,"servings":[{"label":"2 tbsp","grams":32},{"label":"1 tbsp","grams":16}],"nutrients":{"calories":75},"aiEstimated":false,"source":"cache"}"#
        let entry = try JSONDecoder().decode(LogEntry.self, from: Data(json.utf8))
        let p = PortionModel(entry: entry)
        XCTAssertEqual(p.choice, .serving(1))
        XCTAssertEqual(p.whole, 0)
        XCTAssertEqual(p.fraction, 0.75, accuracy: 1e-9)
        XCTAssertEqual(p.meal, .breakfast)
        XCTAssertEqual(p.previewCalories, 75, "the same amount reads the same")
        p.whole = 1
        p.fraction = 0.5
        XCTAssertEqual(p.previewCalories, 150) // 1.5 tbsp of a 200-cal 2 tbsp
    }

    func testAnEntryInGrams() throws {
        let json = #"{"id":6,"day":"2026-11-18","meal":"lunch","name":"Rice","brand":null,"icon":"🍚","servingIndex":0,"unit":"g","quantity":150,"fraction":1,"servings":[{"label":"1 cup","grams":158}],"nutrients":{"calories":195},"aiEstimated":false,"source":"cache"}"#
        let p = PortionModel(entry: try JSONDecoder().decode(LogEntry.self, from: Data(json.utf8)))
        XCTAssertEqual(p.choice, .unit(.g))
        XCTAssertEqual(p.whole, 150)
        XCTAssertEqual(p.previewCalories, 195)
    }

    func testAnEntryPreviewsFromTheFoodsOwnNutrients() throws {
        // 1 g of 349 cal/100 g is stored as 3 cal; worked back from that it read "300" at 100 g
        let json = #"{"id":7,"day":"2026-11-18","meal":"lunch","name":"Rice","brand":null,"icon":"🍚","servingIndex":0,"unit":"g","quantity":1,"fraction":1,"servings":[{"label":"100 g","grams":100}],"nutrients":{"calories":3},"perServing":{"calories":349},"aiEstimated":false,"source":"user"}"#
        let p = PortionModel(entry: try JSONDecoder().decode(LogEntry.self, from: Data(json.utf8)))
        p.whole = 100
        XCTAssertEqual(p.previewCalories, 349)
    }

    func testAnEntryStoredAtZeroStillPreviews() throws {
        let json = #"{"id":8,"day":"2026-11-18","meal":"lunch","name":"Lettuce","brand":null,"icon":"🥬","servingIndex":0,"unit":"g","quantity":1,"fraction":1,"servings":[{"label":"100 g","grams":100}],"nutrients":{"calories":0},"perServing":{"calories":15},"aiEstimated":false,"source":"user"}"#
        let p = PortionModel(entry: try JSONDecoder().decode(LogEntry.self, from: Data(json.utf8)))
        p.whole = 200
        XCTAssertEqual(p.previewCalories, 30)
    }

    func testServingsOnlyForAIEstimates() {
        let p = PortionModel(name: "Egg", icon: "🥚", servings: [Serving(label: "1 large egg", grams: 50)], nutrients: Nutrients(["calories": 72]), meal: .breakfast, servingsOnly: true)
        XCTAssertEqual(p.choices.map(\.label), ["1 large egg"])
    }
}
